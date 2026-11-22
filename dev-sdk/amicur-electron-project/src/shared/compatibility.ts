import type { Mod } from './types.js';

export interface ModRules { tested?: string[]; requires?: string[]; conflicts?: string[]; version?: string; problem?: string }
export function formatProblems(problems: string[], locale: string) {
  const titles: Record<string, string> = locale === 'ru-RU'
    ? { cycle: 'Циклическая зависимость', missing: 'Мод отсутствует', requires: 'Включите зависимость', conflicts: 'Конфликт модов' }
    : { cycle: 'Dependency cycle', missing: 'Missing mod', requires: 'Enable dependency', conflicts: 'Conflicting mods' };
  return problems.map(problem => problem.replace(/^(cycle|missing|requires|conflicts):/, (_, key: string) => titles[key] + ':')).join('\n');
}
export function resolveMods(mods: Mod[], enabled: Set<string>) {
  const ordered: string[] = [];
  const problems: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byId = new Map(mods.map(mod => [mod.id, mod]));
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) { problems.push('cycle: ' + [...visiting, id].join(' → ')); return; }
    const mod = byId.get(id);
    if (!mod) { problems.push('missing: ' + id); return; }
    visiting.add(id);
    if (mod.problem) problems.push(id + ': ' + mod.problem);
    for (const dependency of mod.requires ?? []) {
      if (!enabled.has(dependency)) problems.push('requires: ' + id + ' → ' + dependency);
      else visit(dependency);
    }
    for (const other of mod.conflicts ?? []) if (enabled.has(other)) problems.push('conflicts: ' + id + ' / ' + other);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  }
  for (const id of enabled) visit(id);
  return { ordered, problems: [...new Set(problems)] };
}
