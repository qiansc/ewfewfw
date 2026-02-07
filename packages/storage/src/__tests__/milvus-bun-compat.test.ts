import { afterAll, describe, expect, test } from 'bun:test';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

type StepStatus = 'pass' | 'fail' | 'skip';

type StepResult = {
  name: string;
  status: StepStatus;
  error?: string;
};

const milvusUrl = process.env.C4A_TEST_MILVUS_URL;
const milvusToken = process.env.C4A_TEST_MILVUS_TOKEN;
const enabled = Boolean(milvusUrl);

const collectionName = `c4a_bun_compat_${Date.now().toString(36)}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let client: MilvusClient | null = null;
let created = false;
const steps: StepResult[] = [];

function recordStep(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => {
      steps.push({ name, status: 'pass' });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ name, status: 'fail', error: message });
      throw error;
    });
}

function recordSkip(name: string, reason: string) {
  steps.push({ name: `${name} (${reason})`, status: 'skip' });
}

function reportSummary() {
  const passed = steps.filter((step) => step.status === 'pass').length;
  const failed = steps.filter((step) => step.status === 'fail').length;
  const skipped = steps.filter((step) => step.status === 'skip').length;
  const overall =
    failed > 0 ? 'incompatible' : passed > 0 && skipped === 0 ? 'compatible' : 'unknown';
  const lines = [
    `[milvus-bun-compat] total=${steps.length} passed=${passed} failed=${failed} skipped=${skipped}`,
    `[milvus-bun-compat] overall=${overall}`,
    ...steps.map((step) =>
      step.status === 'pass'
        ? `  - PASS ${step.name}`
        : step.status === 'skip'
          ? `  - SKIP ${step.name}`
          : `  - FAIL ${step.name}: ${step.error ?? 'unknown error'}`
    ),
  ];
  if (failed > 0) {
    lines.push('  - Suggestion: if gRPC is incompatible, consider REST API fallback.');
  }
  // eslint-disable-next-line no-console
  console.info(lines.join('\n'));
}

async function dropCollectionIfNeeded() {
  if (!client || !created) return;
  try {
    await client.dropCollection({ collection_name: collectionName });
  } catch {
    // ignore cleanup errors
  }
}

afterAll(async () => {
  await dropCollectionIfNeeded();
  reportSummary();
});

describe('Milvus SDK Bun compatibility', () => {
  test('grpc connect/create/insert/search/delete lifecycle', async () => {
    if (!enabled) {
      recordSkip('milvus grpc lifecycle', 'env not set (C4A_TEST_MILVUS_URL)');
      return;
    }

    client = new MilvusClient({
      address: milvusUrl ?? '',
      token: milvusToken,
    });

    await recordStep('list collections', async () => {
      const list = await client?.listCollections();
      expect(list?.status?.error_code).toBe('Success');
    });

    await recordStep('create collection', async () => {
      const response = await client?.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: 'uuid',
            data_type: 21,
            is_primary_key: true,
            max_length: 64,
          },
          { name: 'text', data_type: 21, max_length: 4096 },
          {
            name: 'vector',
            data_type: 101,
            type_params: { dim: '4' },
          },
        ],
      });
      expect(response?.error_code).toBe('Success');
      created = true;
    });

    await recordStep('create index', async () => {
      const response = await client?.createIndex({
        collection_name: collectionName,
        field_name: 'vector',
        index_type: 'AUTOINDEX',
        metric_type: 'COSINE',
      });
      expect(response?.error_code).toBe('Success');
    });

    await recordStep('load collection', async () => {
      const response = await client?.loadCollectionSync({ collection_name: collectionName });
      expect(response?.error_code).toBe('Success');
    });

    const uuid = `compat-${Date.now().toString(36)}`;
    const vector = [0.1, 0.2, 0.3, 0.4];

    await recordStep('insert vector', async () => {
      const response = await client?.insert({
        collection_name: collectionName,
        fields_data: [
          {
            uuid,
            text: 'bun milvus compatibility test',
            vector,
          },
        ],
      });
      expect(response?.status?.error_code).toBe('Success');
    });

    await recordStep('flush', async () => {
      const response = await client?.flushSync({ collection_names: [collectionName] });
      expect(response?.status?.error_code).toBe('Success');
    });

    await recordStep('search vector', async () => {
      const response = await client?.search({
        collection_name: collectionName,
        anns_field: 'vector',
        data: [vector],
        output_fields: ['uuid', 'text'],
        limit: 3,
      });

      const rawResults = (response?.results ?? []) as unknown;
      const results = Array.isArray(rawResults) ? rawResults : [];

      const flattened = Array.isArray(results[0]) ? (results[0] as Array<unknown>) : results;
      const uuids = flattened
        .map((item) => (item && typeof item === 'object' ? (item as { uuid?: string }).uuid : ''))
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

      expect(uuids.includes(uuid)).toBe(true);
    });

    await recordStep('delete entity', async () => {
      const response = await client?.deleteEntities({
        collection_name: collectionName,
        expr: `uuid == "${uuid}"`,
      });
      expect(response?.status?.error_code).toBe('Success');
    });
  });
});
