import { runHookCommand } from "./hook.js";

export type CommandHandler = () => Promise<void>;

export const commands: Record<string, CommandHandler> = {
  hook: runHookCommand,
};
