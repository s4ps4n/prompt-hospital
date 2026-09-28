import type { AssignableRole, CatalogEntry, Priority, Role } from './types'

export const COORDINATOR_ID = 'w0'
export const COORDINATOR_ROLE: Role = 'координатор'

export const ROLES: readonly AssignableRole[] = [
  'исполнитель',
  'архитектор',
  'фулстак',
  'сисадмин',
  'дизайнер',
  'UX/UI',
  'приёмщик',
]

export const PRIORITY_LABEL: Record<Priority, string> = {
  3: 'высокий',
  2: 'средний',
  1: 'низкий',
}

export const CATALOG: readonly CatalogEntry[] = [
  { model: 'deepseek', name: 'DeepSeek', provider: 'DeepSeek', hair: '#3cc8dc', color: '#0fa0be', skin: '#f2c9a0', style: 'cap', acc: 'wings' },
  { model: 'claude', name: 'Claude', provider: 'Anthropic', hair: '#e09060', color: '#d07040', skin: '#f5d2b0', style: 'bob' },
  { model: 'gpt5', name: 'GPT-5', provider: 'OpenAI', hair: '#5fbf8a', color: '#3f9f6a', skin: '#e0a878', style: 'quiff', acc: 'glasses' },
  { model: 'gemini', name: 'Gemini', provider: 'Google', hair: '#7aa0e8', color: '#4a74c8', skin: '#f2c9a0', style: 'bun' },
  { model: 'qwen', name: 'Qwen', provider: 'Alibaba', hair: '#b080e8', color: '#8a58c8', skin: '#f5d2b0', style: 'spiky', acc: 'headset' },
  { model: 'mistral', name: 'Mistral', provider: 'Mistral AI', hair: '#e8b060', color: '#c88830', skin: '#c68a5a', style: 'quiff' },
  { model: 'grok', name: 'Grok', provider: 'xAI', hair: '#8fb8c0', color: '#5f8f98', skin: '#e0a878', style: 'spiky' },
  { model: 'llama', name: 'Llama', provider: 'Meta', hair: '#b0bcc8', color: '#7f8f9f', skin: '#f2c9a0', style: 'cap', acc: 'glasses' },
]

export function findCatalogEntry(model: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.model === model)
}

export function isAssignableRole(role: string): role is AssignableRole {
  return (ROLES as readonly string[]).includes(role)
}
