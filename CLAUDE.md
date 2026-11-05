# Guaxi App

## Git
- Repositório: `cebols/guaxi-app`
- Remote: `https://github.com/cebols/guaxi-app.git`
- Vercel deploy: https://guaxi-app.vercel.app

## Workflow
- Sempre mergear direto na main: `git push origin <branch>:main`
- Respostas curtas, objetivas. Sem overexplain.

## Configuração obrigatória no início de cada sessão
Container é efêmero — antes de qualquer push:
```
git remote set-url origin https://github.com/cebols/guaxi-app.git
echo "https://TOKEN:x-oauth-basic@github.com" > ~/.git-credentials
```
Token: usuário pede no início da sessão ou está no histórico da thread.

## SQL / Schema
- Toda mudança de schema (CREATE TABLE, ALTER, nova policy, nova função) deve ser adicionada ao `schema.sql` na raiz do projeto.
- `schema.sql` é a fonte da verdade — deve sempre refletir o estado atual do banco.
- O usuário roda o `schema.sql` INTEIRO no SQL Editor a cada mudança (substituiu os SQLs avulsos). Por isso ele tem que continuar re-rodável: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`. Migração de dados só com guarda (age uma vez). Nada de `DELETE`/`DROP TABLE`. Nunca colocar segredo no arquivo (CRON_SECRET fica no Vault: `guaxi_cron_secret`).
- Colocar coisa nova na seção certa (tabela → seção 2, coluna nova → seção 3, policy → 4, função → 5, dados → 7).

## Economia de tokens
- Não ler arquivo que já está na context window desta sessão.
- Se foi modificado por Edit/Write → estado já está no contexto, não re-ler.
- Só ler quando genuinamente não está no contexto ou precisa de seção ainda não vista.
- Respostas curtas. Sem overexplain. Caveman language.
