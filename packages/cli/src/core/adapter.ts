export interface StorageAdapter {
  mode: string;
}

export async function getAdapter(mode: string): Promise<StorageAdapter> {
  return { mode };
}
