import type { AIContentBlock, AIRequest } from "../../src/types";

export declare const KEY_RE: RegExp;
export declare const MAX_KEY_LEN: number;
export declare const KB: number;
export declare const MB: number;
export interface Limits { maxValueBytes: number; quotaBytes: number; maxKeys: number }
export declare const DEFAULT_LIMITS: Limits;
export declare function utf8Len(s: string): number;
export declare function cleanKey(key: unknown): string;
export declare function encodeValue(value: unknown): string;
export declare function entryBytes(key: string, value: unknown): number;
export interface Backend {
  data: Map<string, unknown>;
  limits: Limits;
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): { ok: true; key: string; bytes: number };
  delete(key: unknown): boolean;
  list(prefix?: unknown): string[];
  usedBytes(): number;
}
export declare function createBackend(limits?: Partial<Limits>, data?: Map<string, unknown>): Backend;

/** Anthropic Messages response body (what flinsh.ai.chat resolves with). */
export interface MessageBody {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AIContentBlock[];
  stop_reason: string;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}
export declare const CANNED_MODEL: string;
export declare function messageBody(content: AIContentBlock[], stopReason?: string): MessageBody;
export declare function textReply(text: string): MessageBody;
export declare function toolReply(name: string, input: object, text?: string, id?: string): MessageBody;
export interface CannedProposalInput {
  title: string;
  exercises: { name: string; sets: number; reps: string; weight?: number }[];
  reason: string;
}
export declare const CANNED_PROPOSAL: CannedProposalInput;
export declare const CANNED: { proposalText: string; chatDefault: string; afterToolResult: string };
export declare function latestUserText(req: AIRequest | Record<string, unknown>): string;
export declare function isPlanTodayPrompt(system: unknown): boolean;
export declare function classify(req: AIRequest | Record<string, unknown>): "after-tool" | "propose" | "chat";
export declare function cannedAi(req: AIRequest | Record<string, unknown>): MessageBody;
export declare function aiError(code: string, message?: string): Error & { code: string };
