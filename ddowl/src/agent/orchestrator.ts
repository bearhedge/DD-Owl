/**
 * DD Owl Agent Orchestrator
 *
 * Implements the ReAct (Reason + Act) loop for AI-driven research.
 * The agent reasons about the task, calls tools, observes results, and repeats.
 */

import {
  Tool,
  ToolResult,
  ToolContext,
  Message,
  FunctionCall,
  AgentResult,
  AgentProgress,
  AgentState,
  Affiliation,
  CompanyDetails,
} from './tools/types.js';
import { getTool, getAllTools, formatToolsForAPI } from './tools/registry.js';
import { getDDAgentSystemPrompt } from './prompts.js';
import { ChromeBrowserBridge, getBrowserBridge } from './browser-bridge.js';

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2';
const MAX_ITERATIONS = 50;

interface KimiResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: FunctionCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DDOwlAgent {
  private tools: Tool[];
  private conversationHistory: Message[] = [];
  private browserBridge: ChromeBrowserBridge;
  private agentState: AgentState;
  private progress: AgentProgress;
  private onProgress?: (progress: AgentProgress) => void;

  constructor(options?: { onProgress?: (progress: AgentProgress) => void }) {
    this.tools = getAllTools();
    this.browserBridge = getBrowserBridge();
    this.onProgress = options?.onProgress;

    this.agentState = {
      affiliations: [],
      companyDetails: new Map(),
      companiesVisited: 0,
      companiesTotal: 0,
    };

    this.progress = {
      taskId: `task_${Date.now()}`,
      status: 'running',
      currentStep: 'Initializing...',
      toolCalls: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Run the agent with a given task
   */
  async run(task: string): Promise<AgentResult> {
    const startTime = Date.now();
    let toolCallCount = 0;

    try {
      // Initialize
      this.updateProgress('Connecting to Chrome...');

      if (!this.browserBridge.isConnected()) {
        const connected = await this.browserBridge.connect();
        if (!connected) {
          throw new Error('Failed to connect to Chrome. Start Chrome with --remote-debugging-port=9222');
        }
      }

      // Set up conversation
      const systemPrompt = getDDAgentSystemPrompt();
      this.conversationHistory = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ];

      this.updateProgress('Starting research...');

      // ReAct loop
      while (this.conversationHistory.length < MAX_ITERATIONS * 2) {
        // Call Kimi
        const response = await this.callKimi();

        if (!response.choices || response.choices.length === 0) {
          throw new Error('No response from Kimi');
        }

        const choice = response.choices[0];
        const message = choice.message;

        // Add assistant message to history
        this.conversationHistory.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        });

        // Check if there are tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // Execute each tool call
          for (const toolCall of message.tool_calls) {
            toolCallCount++;
            const result = await this.executeTool(toolCall);

            // Add tool result to history
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: result.success,
                observation: result.observation,
                data: result.data,
              }),
            });
          }
        } else {
          // No tool calls - agent is done
          this.progress.status = 'completed';
          this.updateProgress('Research complete');

          return {
            success: true,
            response: message.content || '',
            data: {
              affiliations: this.agentState.affiliations,
              companyDetails: Object.fromEntries(this.agentState.companyDetails),
            },
            toolCallCount,
            duration: Date.now() - startTime,
          };
        }

        // Check for stop conditions
        if (choice.finish_reason === 'stop' && !message.tool_calls) {
          break;
        }
      }

      // Max iterations reached
      this.progress.status = 'failed';
      this.updateProgress('Max iterations reached');

      return {
        success: false,
        error: 'Max iterations reached without completion',
        toolCallCount,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.progress.status = 'failed';
      this.updateProgress(`Error: ${error.message}`);

      return {
        success: false,
        error: error.message,
        toolCallCount,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Call Kimi API
   */
  private async callKimi(): Promise<KimiResponse> {
    const apiKey = process.env.KIMI_API_KEY;
    if (!apiKey) {
      throw new Error('KIMI_API_KEY environment variable not set');
    }

    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: this.conversationHistory,
        tools: formatToolsForAPI(this.tools),
        tool_choice: 'auto',
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API error: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  /**
   * Execute a tool call
   */
  private async executeTool(toolCall: FunctionCall): Promise<ToolResult> {
    const toolName = toolCall.function.name;
    const tool = getTool(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
        observation: `Tool "${toolName}" not found. Available tools: ${this.tools.map(t => t.name).join(', ')}`,
      };
    }

    // Parse arguments
    let params: any;
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      return {
        success: false,
        error: 'Invalid tool arguments',
        observation: `Failed to parse arguments for ${toolName}: ${toolCall.function.arguments}`,
      };
    }

    // Update progress
    this.progress.toolCalls.push({
      tool: toolName,
      status: 'running',
    });
    this.updateProgress(`Executing: ${toolName}`);

    // Create tool context
    const context: ToolContext = {
      browserBridge: this.browserBridge,
      reportProgress: (msg) => this.updateProgress(msg),
      agentState: this.agentState,
      callKimi: async (prompt) => this.callKimiSimple(prompt),
    };

    // Execute tool
    try {
      const result = await tool.execute(params, context);

      // Update tool call status
      const lastToolCall = this.progress.toolCalls[this.progress.toolCalls.length - 1];
      lastToolCall.status = result.success ? 'completed' : 'failed';
      lastToolCall.observation = result.observation;

      return result;
    } catch (error: any) {
      const lastToolCall = this.progress.toolCalls[this.progress.toolCalls.length - 1];
      lastToolCall.status = 'failed';
      lastToolCall.observation = error.message;

      return {
        success: false,
        error: error.message,
        observation: `Tool execution failed: ${error.message}`,
      };
    }
  }

  /**
   * Simple Kimi call for tools that need LLM (like translation)
   */
  private async callKimiSimple(prompt: string): Promise<string> {
    const apiKey = process.env.KIMI_API_KEY;
    if (!apiKey) {
      throw new Error('KIMI_API_KEY not set');
    }

    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'kimi-k2', // Use K2 for simple tasks
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Kimi API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Update and broadcast progress
   */
  private updateProgress(step: string): void {
    this.progress.currentStep = step;
    this.progress.updatedAt = new Date().toISOString();

    if (this.onProgress) {
      this.onProgress(this.progress);
    }

    console.log(`[Agent] ${step}`);
  }

  /**
   * Get current progress
   */
  getProgress(): AgentProgress {
    return this.progress;
  }

  /**
   * Get collected data
   */
  getData(): AgentState {
    return this.agentState;
  }
}

/**
 * Create and run an agent for a task
 */
export async function runAgent(
  task: string,
  onProgress?: (progress: AgentProgress) => void
): Promise<AgentResult> {
  const agent = new DDOwlAgent({ onProgress });
  return await agent.run(task);
}
