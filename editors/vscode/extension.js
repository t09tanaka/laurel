const vscode = require('vscode');
const configSchema = require('./schemas/laurel.config.schema.json');

const LAUREL_TASKS = [
  { task: 'build', label: 'laurel build', group: 'build', command: 'laurel build' },
  { task: 'dev', label: 'laurel dev', group: 'build', command: 'laurel dev' },
  { task: 'check', label: 'laurel check', group: 'test', command: 'laurel check' },
];

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'laurel-config', scheme: 'file' },
      new LaurelConfigCompletionProvider(configSchema),
      '.',
      '[',
      '"',
    ),
  );

  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('laurel', {
      provideTasks() {
        return LAUREL_TASKS.map(createTask);
      },
      resolveTask(task) {
        const requested = task.definition.task;
        const spec = LAUREL_TASKS.find((candidate) => candidate.task === requested);
        return spec ? createTask(spec) : undefined;
      },
    }),
  );
}

function deactivate() {}

class LaurelConfigCompletionProvider {
  constructor(schema) {
    this.schema = schema;
  }

  provideCompletionItems(document, position) {
    if (isTableHeaderLine(document.lineAt(position.line).text, position.character)) {
      return this.createTableCompletions();
    }

    const currentLine = document.lineAt(position.line).text.slice(0, position.character);
    if (/^\s*[\w.-]+\s*=/.test(currentLine)) return undefined;

    const sectionPath = findCurrentSectionPath(document, position.line);
    const schemaNode = resolveSchemaForPath(this.schema, sectionPath);
    const properties = collectProperties(schemaNode);
    if (!properties) return undefined;

    const existingKeys = collectExistingKeys(document, sectionPath, position.line);
    return Object.entries(properties)
      .filter(([key]) => !existingKeys.has(key))
      .map(([key, property]) => createPropertyCompletion(key, property));
  }

  createTableCompletions() {
    const root = resolveRef(this.schema, this.schema.$ref) || this.schema;
    const properties = collectProperties(root);
    if (!properties) return undefined;

    return Object.entries(properties)
      .filter(([, property]) =>
        collectProperties(resolveRef(this.schema, property.$ref) || property),
      )
      .map(([key, property]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
        item.detail = 'Laurel config section';
        item.documentation = new vscode.MarkdownString(property.description || '');
        item.insertText = key;
        return item;
      });
  }
}

function createTask(spec) {
  const task = new vscode.Task(
    { type: 'laurel', task: spec.task },
    vscode.TaskScope.Workspace,
    spec.label,
    'laurel',
    new vscode.ShellExecution(spec.command),
    ['$laurel'],
  );
  if (spec.group === 'build') task.group = vscode.TaskGroup.Build;
  if (spec.group === 'test') task.group = vscode.TaskGroup.Test;
  return task;
}

function createPropertyCompletion(key, property) {
  const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
  item.detail = describeType(property);
  if (property.description) {
    item.documentation = new vscode.MarkdownString(property.description);
  }
  item.insertText = new vscode.SnippetString(`${key} = ${snippetForProperty(property)}`);
  return item;
}

function findCurrentSectionPath(document, lineNumber) {
  for (let line = lineNumber; line >= 0; line -= 1) {
    const match = document.lineAt(line).text.match(/^\s*\[+([^\]]+)\]+\s*(?:#.*)?$/);
    if (match)
      return match[1]
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
  }
  return [];
}

function collectExistingKeys(document, sectionPath, beforeLine) {
  const keys = new Set();
  let insideTarget = sectionPath.length === 0;

  for (let line = 0; line < beforeLine; line += 1) {
    const text = document.lineAt(line).text;
    const section = text.match(/^\s*\[+([^\]]+)\]+\s*(?:#.*)?$/);
    if (section) {
      const currentPath = section[1]
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
      insideTarget = pathsEqual(currentPath, sectionPath);
      continue;
    }
    if (!insideTarget) continue;

    const key = text.match(/^\s*([\w.-]+)\s*=/);
    if (key) keys.add(key[1]);
  }

  return keys;
}

function resolveSchemaForPath(schema, path) {
  let current = resolveRef(schema, schema.$ref) || schema;
  for (const segment of path) {
    const properties = collectProperties(current);
    if (!properties || !properties[segment]) return undefined;
    current = resolveRef(schema, properties[segment].$ref) || properties[segment];
    if (current.type === 'array' && current.items) {
      current = resolveRef(schema, current.items.$ref) || current.items;
    }
  }
  return current;
}

function collectProperties(schemaNode) {
  if (!schemaNode) return undefined;
  if (schemaNode.properties) return schemaNode.properties;
  for (const branchKey of ['allOf', 'anyOf', 'oneOf']) {
    if (!Array.isArray(schemaNode[branchKey])) continue;
    for (const branch of schemaNode[branchKey]) {
      const properties = collectProperties(resolveRef(configSchema, branch.$ref) || branch);
      if (properties) return properties;
    }
  }
  return undefined;
}

function resolveRef(schema, ref) {
  if (!ref || !ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce((node, part) => (node ? node[part] : undefined), schema);
}

function snippetForProperty(property) {
  const resolved = resolveRef(configSchema, property.$ref) || property;
  if (resolved.default !== undefined) return JSON.stringify(resolved.default);
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return `\${1|${resolved.enum.join(',')}|}`;
  }
  if (resolved.type === 'boolean') return '${1|true,false|}';
  if (resolved.type === 'number' || resolved.type === 'integer') return '${1:0}';
  if (resolved.type === 'array') return '[]';
  if (resolved.type === 'object' || resolved.properties) return '{}';
  return '"${1}"';
}

function describeType(property) {
  const resolved = resolveRef(configSchema, property.$ref) || property;
  if (Array.isArray(resolved.enum)) return resolved.enum.join(' | ');
  if (Array.isArray(resolved.type)) return resolved.type.join(' | ');
  if (resolved.type) return resolved.type;
  if (resolved.anyOf) return 'multiple types';
  return 'Laurel config property';
}

function isTableHeaderLine(text, character) {
  return /^\s*\[+[\w.-]*$/.test(text.slice(0, character));
}

function pathsEqual(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

module.exports = {
  activate,
  deactivate,
};
