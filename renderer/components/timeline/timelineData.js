/**
 * Sample timeline data matching the Claude/Perplexity screenshots.
 *
 * Shape for each step:
 * {
 *   id:        string                  — unique identifier
 *   type:      "status" | "search" | "file" | "reasoning" | "done"
 *   title:     string                  — short step headline
 *   status:    "loading" | "complete"  — current state (auto-inferred if omitted)
 *   content:   object                  — type-specific payload (see below)
 *   timestamp: string (optional)       — display timestamp
 * }
 *
 * content by type:
 *   status    → { description: string, result?: string }
 *   search    → { queries: string[] }
 *   file      → { files: { name: string, subtitle?: string, successText?: string }[] }
 *   reasoning → { text: string, bullets?: string[], collapsedLines?: number }
 *   done      → { summary?: string }
 */

const SAMPLE_TIMELINE_STEPS = [
  {
    id: 'step-1',
    type: 'status',
    title: 'Processing attachments...',
    status: 'complete',
    content: {
      description: 'Reading 1 attached file',
      result: 'Successfully read 1 attached file.',
    },
  },
  {
    id: 'step-2',
    type: 'search',
    title: "Understanding the paper's architecture to draft the corresponding implementation code",
    status: 'complete',
    content: {
      queries: [
        'neural network architecture',
        'model architecture',
        'proposed model',
        'network structure',
        'layers',
        'components',
      ],
    },
  },
  {
    id: 'step-3',
    type: 'file',
    title: 'Reviewing attached document',
    status: 'complete',
    content: {
      files: [
        {
          name: 'Main_Manuscript_Springer_compressed.pdf',
          subtitle: 'Main_Manuscript_Springer_compressed',
          successText: 'Successfully read',
        },
      ],
    },
  },
  {
    id: 'step-4',
    type: 'search',
    title: 'Searching the provided files for the liquid time-constant neuron and LTC layer implementations',
    status: 'complete',
    content: {
      queries: [
        'liquid time-constant neuron',
        'LTC neuron',
        'liquid neuron equations',
        'LTC layer implementation',
        'liquid layer code',
        'PyTorch liquid',
      ],
    },
  },
  {
    id: 'step-5',
    type: 'file',
    title: 'Reviewing source material',
    status: 'complete',
    content: {
      files: [
        {
          name: 'Main_Manuscript_Springer_compressed.pdf',
          subtitle: 'Main_Manuscript_Springer_compressed',
          successText: 'Successfully read',
        },
      ],
    },
  },
  {
    id: 'step-6',
    type: 'reasoning',
    title: 'Analyzing training code',
    status: 'complete',
    content: {
      text: "The user wants suggestions to improve their training code for better results. Let me analyze the code and history.json to understand the current state and suggest improvements.\n\nFrom the history.json, after 50 epochs:",
      bullets: [
        'Val IoU peaks around ~0.473 (epoch 31) and plateaus',
        'Val F1 peaks around ~0.627 (epoch 31) and plateaus',
        'Learning rate decays aggressively from 1e-4 down to 7.8e-7 by epoch 50',
        "The LR scheduler is reducing too aggressively - by epoch 50 it's nearly zero",
      ],
      collapsedLines: 4,
    },
  },
  {
    id: 'step-7',
    type: 'status',
    title: 'Now let me create a training dashboard visualization from the history.json, then provide specific code improvements.',
    status: 'complete',
    content: {},
  },
  {
    id: 'step-8',
    type: 'done',
    title: 'Done',
    status: 'complete',
    content: {
      summary: 'Analysis complete — ready to present results.',
    },
  },
]

export default SAMPLE_TIMELINE_STEPS
