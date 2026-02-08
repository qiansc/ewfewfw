export type CliMode = "local" | "remote";
export type InstallMode = CliMode | "skip";

export interface CommandContext {
  argv: string[];
  cwd: string;
}
