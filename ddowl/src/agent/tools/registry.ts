/**
 * Tool Registry
 *
 * Central registry for all available tools.
 * Provides tool lookup, validation, and OpenAI-compatible formatting.
 */

import { Tool, JSONSchema } from './types.js';
import { DD_TOOLS } from './dd-tools.js';

// Registry of all available tools
const toolRegistry: Map<string, Tool> = new Map();

/**
 * Register a tool in the registry
 */
export function registerTool(tool: Tool): void {
  if (toolRegistry.has(tool.name)) {
    console.warn(`Tool "${tool.name}" is being overwritten`);
  }
  toolRegistry.set(tool.name, tool);
}

/**
 * Register multiple tools at once
 */
export function registerTools(tools: Tool[]): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

/**
 * Get a tool by name
 */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

/**
 * Get all registered tools
 */
export function getAllTools(): Tool[] {
  return Array.from(toolRegistry.values());
}

/**
 * Get tool names
 */
export function getToolNames(): string[] {
  return Array.from(toolRegistry.keys());
}

/**
 * Check if a tool exists
 */
export function hasTool(name: string): boolean {
  return toolRegistry.has(name);
}

/**
 * Format tools for OpenAI/Kimi function calling API
 *
 * Converts our Tool format to the format expected by the API:
 * {
 *   type: "function",
 *   function: {
 *     name: "...",
 *     description: "...",
 *     parameters: {...}
 *   }
 * }
 */
export function formatToolsForAPI(tools?: Tool[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}> {
  const toolList = tools || getAllTools();

  return toolList.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Format tools as a text description for system prompts
 *
 * Creates a human-readable list of tools and their descriptions.
 */
export function formatToolDescriptions(tools?: Tool[]): string {
  const toolList = tools || getAllTools();

  return toolList
    .map(tool => {
      const params = tool.parameters.properties
        ? Object.entries(tool.parameters.properties)
            .map(([name, prop]: [string, any]) => {
              const required = tool.parameters.required?.includes(name) ? ' (required)' : '';
              return `    - ${name}: ${prop.description || prop.type}${required}`;
            })
            .join('\n')
        : '    (no parameters)';

      return `${tool.name}:\n  ${tool.description.split('\n')[0]}\n  Parameters:\n${params}`;
    })
    .join('\n\n');
}

/**
 * Validate tool parameters against schema
 *
 * Basic validation - checks required fields and types.
 */
export function validateToolParams(toolName: string, params: any): { valid: boolean; errors: string[] } {
  const tool = getTool(toolName);
  if (!tool) {
    return { valid: false, errors: [`Tool "${toolName}" not found`] };
  }

  const errors: string[] = [];
  const schema = tool.parameters;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (params[field] === undefined || params[field] === null) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }
  }

  // Basic type checking
  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties) as [string, any][]) {
      const value = params[name];
      if (value !== undefined && value !== null) {
        const expectedType = prop.type;
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Parameter "${name}" should be an array`);
        } else if (expectedType !== 'array' && actualType !== expectedType) {
          errors.push(`Parameter "${name}" should be ${expectedType}, got ${actualType}`);
        }

        // Check enum values
        if (prop.enum && !prop.enum.includes(value)) {
          errors.push(`Parameter "${name}" must be one of: ${prop.enum.join(', ')}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Initialize the registry with default tools
 */
export function initializeRegistry(): void {
  // Register DD domain tools
  registerTools(DD_TOOLS);

  console.log(`Tool registry initialized with ${toolRegistry.size} tools:`);
  console.log(`  - ${getToolNames().join('\n  - ')}`);
}

/**
 * Clear the registry (for testing)
 */
export function clearRegistry(): void {
  toolRegistry.clear();
}

// Auto-initialize on import
initializeRegistry();
