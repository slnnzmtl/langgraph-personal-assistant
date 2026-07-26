import { truncateToolOutput } from "../tools/output.js";

export type SkillActionDefinition = {
	label: string;
	run: () => Promise<string>;
};

export type SkillActionResult = {
	label: string;
	content: string;
};

export type SkillActionError = {
	label: string;
	error: string;
};

export type SkillActionRegistry = Map<string, Map<string, SkillActionDefinition[]>>;

export const SKILL_CONTEXT_MAX_CHARS = 4_000;

export const createSkillActionRegistry = (): SkillActionRegistry => new Map();

export const registerSkillActions = (
	registry: SkillActionRegistry,
	promptKey: string,
	skillName: string,
	actions: SkillActionDefinition[],
): void => {
	const normalizedSkillName = skillName.toLowerCase();
	const promptActions = registry.get(promptKey) ?? new Map<string, SkillActionDefinition[]>();
	promptActions.set(normalizedSkillName, actions);
	registry.set(promptKey, promptActions);
};

export const getSkillActions = (
	registry: SkillActionRegistry | undefined,
	promptKey: string,
	skillName: string,
): SkillActionDefinition[] => {
	if (!registry) {
		return [];
	}

	return registry.get(promptKey)?.get(skillName.toLowerCase()) ?? [];
};

export const runSkillActions = async (
	actions: SkillActionDefinition[],
): Promise<{ results: SkillActionResult[]; errors: SkillActionError[] }> => {
	const results: SkillActionResult[] = [];
	const errors: SkillActionError[] = [];

	for (const action of actions) {
		try {
			const content = await action.run();
			results.push({ label: action.label, content });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ label: action.label, error: message });
		}
	}

	return { results, errors };
};

export const formatSkillContextBlock = (
	results: SkillActionResult[],
	errors: SkillActionError[],
): string | undefined => {
	if (results.length === 0 && errors.length === 0) {
		return undefined;
	}

	const sections: string[] = [];

	for (const result of results) {
		sections.push(`${result.label}:\n${result.content}`);
	}

	for (const error of errors) {
		sections.push(`action_error ${error.label}:\n${error.error}`);
	}

	const body = truncateToolOutput(sections.join("\n\n"), SKILL_CONTEXT_MAX_CHARS);
	return `<skill_context>\n${body}\n</skill_context>`;
};

export const enrichSkillWithActions = async (options: {
	content: string;
	promptKey: string;
	skillName: string;
	actionRegistry?: SkillActionRegistry;
}): Promise<string> => {
	const actions = getSkillActions(options.actionRegistry, options.promptKey, options.skillName);

	if (actions.length === 0) {
		return options.content;
	}

	const { results, errors } = await runSkillActions(actions);
	const contextBlock = formatSkillContextBlock(results, errors);

	if (!contextBlock) {
		return options.content;
	}

	return `${options.content}\n\n${contextBlock}`;
};
