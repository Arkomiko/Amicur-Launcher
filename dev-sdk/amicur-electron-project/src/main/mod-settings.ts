import type { ModField, ModValue } from '../shared/types.js';

const fieldId = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function modFields(value: unknown): ModField[] {
  return Object.entries(object(value)).slice(0, 32).flatMap(([id, raw]): ModField[] => {
    if (!fieldId.test(id)) return [];
    const field = object(raw);
    const label = typeof field.label === 'string' && field.label.trim() ? field.label.slice(0, 100) : id;
    if (field.type === 'boolean' && typeof field.default === 'boolean') {
      return [{ id, label, type: 'boolean', default: field.default }];
    }
    if (field.type === 'string' && typeof field.default === 'string') {
      return [{ id, label, type: 'string', default: field.default.slice(0, 512) }];
    }
    if (field.type === 'number' && typeof field.default === 'number' && Number.isFinite(field.default)) {
      return [{ id, label, type: 'number', default: field.default }];
    }
    if (field.type === 'choice' && typeof field.default === 'string') {
      const choices = Object.entries(object(field.choices)).slice(0, 32).flatMap(([value, label]) =>
        value.length && value.length <= 100 && typeof label === 'string' && label.trim() ? [{ value, label: label.slice(0, 100) }] : []);
      if (choices.some(choice => choice.value === field.default)) return [{ id, label, type: 'choice', default: field.default, choices }];
    }
    return [];
  });
}

export function values(fields: ModField[], input: unknown): Record<string, ModValue> {
  const saved = object(input);
  return Object.fromEntries(fields.map(field => {
    const value = Object.hasOwn(saved, field.id) ? saved[field.id] : undefined;
    if (field.type === 'choice') return [field.id, field.choices.some(choice => choice.value === value) ? value : field.default];
    if (typeof value !== field.type || (typeof value === 'number' && !Number.isFinite(value))) return [field.id, field.default];
    return [field.id, typeof value === 'string' ? value.slice(0, 512) : value];
  })) as Record<string, ModValue>;
}
