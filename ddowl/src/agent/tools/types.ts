/**
 * Tool Type Definitions for DD Owl AI Agent
 *
 * These types define the interface between the AI brain (Kimi K2)
 * and the semantic tools it can call.
 */

// JSON Schema type for tool parameters (OpenAI-compatible)
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
  description?: string;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: any;
  enum?: string[];
  items?: JSONSchema;
}

/**
 * Tool Definition
 *
 * Each tool has:
 * - name: Unique identifier (used in function calls)
 * - description: Rich description for AI to understand when to use
 * - parameters: JSON Schema defining expected inputs
 * - execute: Function that actually performs the action
 */
export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Tool Execution Context
 *
 * Provides access to shared resources like browser bridge,
 * progress reporting, and agent state.
 */
export interface ToolContext {
  // Browser bridge for Chrome extension communication
  browserBridge: BrowserBridge;

  // Report progress back to the agent/UI
  reportProgress: (message: string) => void;

  // Access to collected data from previous tool calls
  agentState: AgentState;

  // Kimi API for tools that need LLM (like translation)
  callKimi: (prompt: string) => Promise<string>;
}

/**
 * Browser Bridge Interface
 *
 * Abstraction over WebSocket communication with Chrome extension.
 */
export interface BrowserBridge {
  // Navigate Puppeteer to a URL
  navigate(url: string): Promise<void>;

  // Send message to content script and wait for response
  sendToExtension(type: string, data?: any): Promise<any>;

  // Check if connected to Chrome
  isConnected(): boolean;
}

/**
 * Agent State
 *
 * Shared state accumulated across tool calls.
 */
export interface AgentState {
  // The research subject
  subjectName?: string;
  subjectUrl?: string;

  // Data collected
  affiliations: Affiliation[];
  companyDetails: Map<string, CompanyDetails>;

  // Progress tracking
  companiesVisited: number;
  companiesTotal: number;
}

/**
 * Tool Result
 *
 * Every tool returns this structure.
 * The 'observation' field is critical - it's what the AI sees and reasons about.
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  observation: string; // Human-readable result for AI to reason about
}

// Domain-specific types for DD research

export interface Affiliation {
  companyName: string;
  companyUrl: string;
  status: 'active' | 'cancelled' | 'revoked' | string;
  role: string;
  shareholdingPercent: string;
  isCurrent: boolean;
}

export interface CompanyDetails {
  companyName: string;
  companyNameEnglish?: string;
  registrationNumber: string;
  status: string;
  establishedDate?: string;
  legalRepresentative?: string;
}

export interface PersonRole {
  role: string;
  percentage?: string;
  appointmentDate?: string;
  resignationDate?: string;
}

export interface PersonInCompany {
  personName: string;
  found: boolean;
  companyName: string;
  registrationNumber: string;
  roles: PersonRole[];
}

// OpenAI-compatible function calling types

export interface FunctionCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolCallMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: FunctionCall[];
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: FunctionCall[];
  tool_call_id?: string;
}

// Agent result types

export interface AgentResult {
  success: boolean;
  response?: string;
  data?: any;
  error?: string;
  toolCallCount: number;
  duration: number;
}

export interface AgentProgress {
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: string;
  toolCalls: Array<{
    tool: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    observation?: string;
  }>;
  startedAt: string;
  updatedAt: string;
}
