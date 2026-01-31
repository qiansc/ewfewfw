export type CliMode = "local" | "server" | "remote";
export type InstallMode = CliMode | "skip";

export interface CommandContext {
  argv: string[];
  cwd: string;
}
