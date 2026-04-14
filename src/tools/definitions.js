/**
 * CORE_TOOL_DEFINITIONS — always included in every LLM request.
 * Keep this list lean: the more tools here, the more tokens spent per round.
 *
 * DEFERRED tools (MCP + plugins) are loaded on demand via tool_search.
 */
export const CORE_TOOL_DEFINITIONS = [
  // ── Meta / control ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'tool_search',
      description:
        'Search for additional tools (MCP tools, plugins) by keyword and make them available. ' +
        'Call this when you need a capability not in your current tool list. ' +
        'Results are added to your active tools for this session.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search tool names and descriptions.' },
          limit: { type: 'number', description: 'Max results to return (default 5).' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enter_plan_mode',
      description:
        'Enter plan mode. In plan mode write/execute tools (bash, write_file, replace_in_file, ' +
        'replace_in_files, apply_patch) are blocked. Use this to think and plan before acting. ' +
        'Call exit_plan_mode when ready to execute.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exit_plan_mode',
      description: 'Exit plan mode and resume normal execution. Optionally provide a summary of your plan.',
      parameters: {
        type: 'object',
        properties: {
          plan_summary: { type: 'string', description: 'Brief summary of the plan you intend to execute.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enter_worktree',
      description:
        'Create an isolated git worktree and switch all subsequent file operations to it. ' +
        'Ideal for risky or exploratory changes — discard to revert cleanly, or merge when done.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'New branch name to create in the worktree. Auto-generated if omitted.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exit_worktree',
      description: 'Finish working in the current git worktree. Either merge changes into the original branch or discard them.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['merge', 'discard'],
            description: '"merge" commits and merges changes back; "discard" throws them away.'
          },
          commit_message: { type: 'string', description: 'Commit message for uncommitted changes (merge action only).' }
        },
        required: ['action'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description:
        'Write the full TODO list for this task. Replace the entire list each time. ' +
        'Use status: pending | in_progress | completed.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Complete TODO list.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short unique identifier (e.g. "t1").' },
                content: { type: 'string', description: 'Task description.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Task status.'
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Optional priority.'
                }
              },
              required: ['id', 'content', 'status'],
              additionalProperties: false
            }
          }
        },
        required: ['todos'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_resources',
      description: 'List all resources available from connected MCP servers (documents, datasets, etc.).',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Filter by server name (optional).' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_mcp_resource',
      description: 'Read the content of an MCP resource by its URI.',
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Resource URI as returned by list_mcp_resources.' }
        },
        required: ['uri'],
        additionalProperties: false
      }
    }
  }
];

// ── Legacy export alias — internal code that imports TOOL_DEFINITIONS still works ─
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files under a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target directory path. Default is current directory.' },
          maxLines: { type: 'number', description: 'Max files to return.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_files',
      description: 'Search text in files (ripgrep).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search.' },
          path: { type: 'string', description: 'Target path. Default is current directory.' },
          maxLines: { type: 'number', description: 'Max result lines.' }
        },
        required: ['pattern'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute file path.' },
          maxBytes: { type: 'number', description: 'Optional max bytes to read.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write UTF-8 content to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute file path.' },
          content: { type: 'string', description: 'Content to write.' },
          append: { type: 'boolean', description: 'Append instead of overwrite.' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace text in a UTF-8 file with optional all-occurrences mode.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path.' },
          search: { type: 'string', description: 'Search text to replace.' },
          replace: { type: 'string', description: 'Replacement text.' },
          all: { type: 'boolean', description: 'Replace all occurrences if true.' }
        },
        required: ['path', 'search', 'replace'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_files',
      description: 'Replace text in multiple files matched by ripgrep pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'ripgrep pattern to find files containing target text.' },
          search: { type: 'string', description: 'Search text.' },
          replace: { type: 'string', description: 'Replacement text.' },
          path: { type: 'string', description: 'Search root path. Default current directory.' },
          maxFiles: { type: 'number', description: 'Maximum files to modify.' }
        },
        required: ['pattern', 'search', 'replace'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show git diff for current workspace.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged diff if true.' },
          path: { type: 'string', description: 'Optional path filter.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'code_index',
      description: 'Build quick code index by searching function/class/type/export definitions.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target path. Default current directory.' },
          maxLines: { type: 'number', description: 'Max lines returned.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: 'Apply unified patch using apply_patch tool. Use this for precise edits across one or more files.',
      parameters: {
        type: 'object',
        properties: {
          patch: { type: 'string', description: 'Patch content starting with *** Begin Patch and ending with *** End Patch.' }
        },
        required: ['patch'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a bash command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command.' },
          timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds.' }
        },
        required: ['command'],
        additionalProperties: false
      }
    }
  }
];
