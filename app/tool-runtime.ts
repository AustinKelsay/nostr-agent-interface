import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type NostrToolRegistration, createNostrMcpServer } from "../index.js";

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  canonicalInputSchema?: unknown;
  handler?: (params: Record<string, unknown>, extras: unknown) => Promise<unknown>;
};

type ToolListResponse = {
  tools: ToolDefinition[];
  nextCursor?: string;
  [key: string]: unknown;
};

type ToolCallResult = {
  content?: unknown[];
  isError?: boolean;
  [key: string]: unknown;
};

type ToolRuntime = {
  listTools: () => Promise<ToolListResponse>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
  close: () => Promise<void>;
};

function normalizeCallToolResult(response: unknown): ToolCallResult {
  if (!response || typeof response !== "object") {
    return { isError: true, content: [] };
  }

  const responseObj = response as {
    content?: unknown[];
    isError?: unknown;
    [key: string]: unknown;
  };

  return {
    ...responseObj,
    content: Array.isArray(responseObj.content) ? responseObj.content : [],
    isError: responseObj.isError === true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZodValue(value: unknown): boolean {
  return isObject(value) && "_def" in value && typeof (value as { _def?: unknown })._def === "object";
}

function looksLikeZodShape(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }

  return keys.every((key) => isZodValue(value[key]));
}

function buildArgumentSchema(schema: unknown): z.ZodTypeAny | null {
  if (isZodValue(schema)) {
    return schema as z.ZodTypeAny;
  }

  if (!isObject(schema)) {
    return null;
  }

  if (looksLikeZodShape(schema)) {
    try {
      return z.object(schema as Record<string, z.ZodTypeAny>);
    } catch {
      return null;
    }
  }

  return null;
}

function validationError(toolName: string, reason: string): ToolCallResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Invalid arguments for ${toolName}: ${reason}`,
      },
    ],
  };
}

function normalizeToolInputSchema(inputSchema: unknown): unknown {
  if (!isObject(inputSchema)) {
    return inputSchema;
  }

  if ("properties" in inputSchema && isObject(inputSchema.properties)) {
    return inputSchema;
  }

  if ("type" in inputSchema) {
    const typeValue = (inputSchema as { type?: unknown }).type;
    if (typeValue === "object" || typeValue === "string" || typeValue === "array" || typeValue === "number") {
      return inputSchema;
    }
  }

  if (isZodValue(inputSchema)) {
    try {
      return zodToJsonSchema(inputSchema as z.ZodTypeAny, { strictUnions: true });
    } catch {
      return inputSchema;
    }
  }

  if (looksLikeZodShape(inputSchema)) {
    try {
      return zodToJsonSchema(z.object(inputSchema as Record<string, z.ZodTypeAny>), {
        strictUnions: true,
      });
    } catch {
      return inputSchema;
    }
  }

  return inputSchema;
}

function normalizeToolDefinition(tool: NostrToolRegistration): ToolDefinition {
  const normalizedSchema = normalizeToolInputSchema(tool.inputSchema) as NostrToolRegistration["inputSchema"];

  return {
    ...tool,
    canonicalInputSchema: tool.inputSchema,
    inputSchema: normalizedSchema,
  };
}

async function createInProcessToolRuntimeInternal(): Promise<ToolRuntime> {
  const toolMap = new Map<string, ToolDefinition>();

  createNostrMcpServer((tool) => {
    if (typeof tool.handler === "function" && tool.name) {
      toolMap.set(tool.name, normalizeToolDefinition(tool));
    }
  });

  return {
    listTools: async () => {
      const tools = [...toolMap.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return { tools };
    },

    callTool: async (toolName: string, args: Record<string, unknown>) => {
      const tool = toolMap.get(toolName);
      if (!tool) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown tool: ${toolName}`,
            },
          ],
        };
      }

      if (typeof tool.handler !== "function") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `No handler registered for tool: ${toolName}`,
            },
          ],
        };
      }

      try {
        const schema = buildArgumentSchema(tool.canonicalInputSchema ?? tool.inputSchema);
        if (schema) {
          const validation = schema.safeParse(args);
          if (!validation.success) {
            const reason = validation.error.issues
              .map((issue) =>
                `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
              )
              .join("; ");

            return validationError(tool.name, reason || "malformed or invalid arguments");
          }

          const result = await Promise.resolve(tool.handler(validation.data as Record<string, unknown>, {}));
          return normalizeCallToolResult(result);
        }

        const result = await Promise.resolve(tool.handler(args, {}));
        return normalizeCallToolResult(result);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : `Unhandled error in in-process tool runtime for ${toolName}`,
            },
          ],
        };
      }
    },

    close: async () => {
      // Nothing to close for direct, in-process registrations.
    },
  };
}

export async function createInProcessToolRuntime(): Promise<ToolRuntime> {
  return createInProcessToolRuntimeInternal();
}
