// Markdown-flavour input rules so common shortcuts (## heading,
// > quote, * bullet, 1. ordered) turn into proper nodes as the
// author types — the same affordance Ghost Koenig provides.

import { InputRule, inputRules, smartQuotes, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';

function blockQuoteRule(nodeType: Schema['nodes'][string]) {
  return wrappingInputRule(/^\s*>\s$/, nodeType);
}

function orderedListRule(nodeType: Schema['nodes'][string]) {
  return wrappingInputRule(
    /^(\d+)\.\s$/,
    nodeType,
    (match) => ({ order: Number(match[1] ?? 1) }),
    (match, node) => node.childCount + node.attrs.order === Number(match[1] ?? 1),
  );
}

function bulletListRule(nodeType: Schema['nodes'][string]) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType);
}

function codeBlockRule(nodeType: Schema['nodes'][string]) {
  return textblockTypeInputRule(/^```$/, nodeType);
}

function headingRule(nodeType: Schema['nodes'][string], maxLevel: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${maxLevel}})\\s$`),
    nodeType,
    (match) => ({ level: (match[1] ?? '').length }),
  );
}

function horizontalRuleInput(nodeType: Schema['nodes'][string]) {
  return new InputRule(/^---$/, (state, _match, start, end) => {
    return state.tr.replaceRangeWith(start, end, nodeType.create()).scrollIntoView();
  });
}

export function buildInputRules(schema: Schema) {
  const rules = [...smartQuotes];
  const nodes = schema.nodes;
  if (nodes.blockquote) rules.push(blockQuoteRule(nodes.blockquote));
  if (nodes.ordered_list) rules.push(orderedListRule(nodes.ordered_list));
  if (nodes.bullet_list) rules.push(bulletListRule(nodes.bullet_list));
  if (nodes.code_block) rules.push(codeBlockRule(nodes.code_block));
  if (nodes.heading) rules.push(headingRule(nodes.heading, 6));
  if (nodes.horizontal_rule) rules.push(horizontalRuleInput(nodes.horizontal_rule));
  return inputRules({ rules });
}
