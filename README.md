# Bolão Copa 2026

Primeira versão estática para GitHub Pages com tela de palpites, ranking e regras.

## Arquivos principais

- `index.html`: página do bolão.
- `styles.css`: visual responsivo.
- `app.js`: lógica de palpites, pontuação e integração com Supabase.
- `jogos.json`: agenda inicial de exemplo.
- `supabase-config.js`: URL e chave pública do Supabase.
- `supabase/schema.sql`: tabelas e políticas de segurança.
- `supabase/participants_example.sql`: exemplo para cadastrar participantes e convites.
- `supabase/seed_example.sql`: jogos de exemplo para testar no Supabase.

## Rodar localmente

```powershell
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## Ativar Supabase

1. No Supabase, ative `Authentication > Sign In / Providers > Anonymous sign-ins`.
2. No SQL Editor, rode o conteúdo de `supabase/schema.sql`.
3. Edite `supabase/participants_example.sql` com os nomes e convites reais.
4. Rode `supabase/participants_example.sql`.
5. Opcionalmente, rode `supabase/seed_example.sql`.
6. Copie a chave pública do projeto.
7. Edite `supabase-config.js`:

```js
window.BOLAO_SUPABASE = {
  url: "https://xrzpqfzjsckvzylckqgo.supabase.co",
  publishableKey: "SUA_CHAVE_PUBLICA",
  enabled: true
};
```

Nunca coloque `service_role`, senha do banco ou secret key no GitHub.

## Como funciona o convite

Você cadastra cada participante com primeiro nome e convite no Supabase. O convite é gravado como hash no banco.

No primeiro acesso, a pessoa informa:

```text
Primeiro nome
Convite
```

O Supabase cria uma sessão anônima para aquele dispositivo e vincula essa sessão ao participante. No mesmo celular ou PC, a pessoa entra automaticamente nas próximas visitas. Em outro dispositivo, ela informa nome e convite novamente.

## Resultados

Participantes com `is_admin = true` veem a aba `Resultados`.

Nessa aba o admin pode:

- informar ou corrigir o placar final;
- marcar o jogo como `Aberto`, `Bloqueado` ou `Finalizado`;
- informar o classificado em jogos de mata-mata.

Quando um jogo fica `Finalizado`, os palpites desse jogo ficam visíveis para todos e o ranking passa a calcular os pontos.

Antes do jogo estar `Finalizado`, cada participante vê somente o próprio palpite. Nem o admin vê os palpites dos outros pela tela/API pública.

Nos jogos finalizados, o card mostra um botão `Ver palpites`. Ao abrir, aparecem o palpite de cada participante e a pontuação daquele jogo.

Se você já rodou o schema antes desta tela existir, rode novamente o conteúdo de `supabase/schema.sql` no SQL Editor para aplicar as permissões de admin e atualizar a função de convite.

## Publicar no GitHub Pages

Suba estes arquivos para o repositório e ative Pages em `Settings > Pages`, usando a branch principal e a pasta raiz.
