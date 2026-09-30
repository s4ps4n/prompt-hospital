// Снять с портала то, что идёт в конфиг: entityTypeId смарт-процесса счетов, categoryId и STATUS_ID стадий.
// Названия печатаются только чтобы человек узнал стадии — в конфиг идут ID.
// Запуск: node --env-file=.env src/stages.ts [entityTypeId]

import { oauthRest, stageEntityId } from './b24.ts'

const rest = oauthRest({
  portal: process.env.B24_PORTAL ?? '',
  clientId: process.env.B24_CLIENT_ID ?? '',
  clientSecret: process.env.B24_CLIENT_SECRET ?? '',
  tokenFile: process.env.B24_TOKEN_FILE || './data/b24-tokens.json',
})

const arg = process.argv[2] ?? process.env.B24_ENTITY_TYPE_ID
if (!arg) {
  const r = await rest.call('crm.type.list', {})
  console.log('Смарт-процессы портала (entityTypeId — название); «Счета» — 31:')
  for (const t of r.result?.types ?? []) console.log(`  ${t.entityTypeId}\t${t.title}`)
  console.log('\nЗапустите ещё раз с entityTypeId, чтобы увидеть стадии.')
  process.exit(0)
}

const entityTypeId = Number(arg)
const cats = await rest.call('crm.category.list', { entityTypeId })
for (const c of cats.result?.categories ?? []) {
  console.log(`\nВоронка categoryId=${c.id} «${c.name}»`)
  const st = await rest.call('crm.status.list', { filter: { ENTITY_ID: stageEntityId(entityTypeId, c.id) }, order: { SORT: 'ASC' } })
  for (const s of st.result ?? []) console.log(`  ${s.STATUS_ID}\t${s.NAME}`)
}
