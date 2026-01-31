import { createInterface } from "node:readline";

export async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} (y/N) `, (input) => resolve(input));
    });
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

export async function promptInput(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultValue ? ` (${defaultValue})` : "";
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix}: `, (input) => resolve(input));
    });
    const trimmed = answer.trim();
    if (!trimmed && defaultValue !== undefined) {
      return defaultValue;
    }
    return trimmed;
  } finally {
    rl.close();
  }
}
