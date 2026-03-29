/**
 * Represents a single task learning entry in progress.md
 */
export interface TaskLearning {
	timestamp: string;
	task: string;
	engine: string;
	status: "completed" | "failed";
	learnings: string[];
	issuesEncountered: string[];
}

/**
 * Options for reading knowledge context to inject into prompts
 */
export interface KnowledgeContext {
	/** Content from AGENTS.md */
	agentsContent: string;
	/** Recent learnings from progress.md (capped at contextWindow entries) */
	recentLearnings: string;
	/** Codebase patterns summary from progress.md */
	patternsSection: string;
}

/**
 * Knowledge system options
 */
export interface KnowledgeOptions {
	/** Whether the knowledge system is enabled */
	enabled: boolean;
	/** Number of recent learnings to inject (default: 10) */
	contextWindow: number;
}

export const DEFAULT_KNOWLEDGE_OPTIONS: KnowledgeOptions = {
	enabled: true,
	contextWindow: 10,
};
