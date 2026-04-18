import { runHookCommand } from "./hook.js";
import { runLocalCommand } from "./local.js";

export type CommandHandler = () => Promise<void>;

export const commands: Record<string, CommandHandler> = {
  hook: runHookCommand,
  local: runLocalCommand,
};
