// The AI workspace of the tab and the dock's controller (R11; architecture.md
// §10.2, §11): the environment, the mirror of operations, inserts and the
// `dock` view. Loaded with the dock itself — the dock shows nothing without
// its controller. Recap and Coach (with Review, a turn of its dialog) are
// built over the same workspace by their own entries (`ai-analysis`,
// `ai-coach`).

export { AiWorkspace, createDockController, readTargetHandle, type AiController, type AiPorts, type FileSaver } from '@cg/core/application/ai';
