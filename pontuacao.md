# Pontuacao atual do bolao

Este documento descreve a pontuacao como ela esta implementada atualmente no app.

## Regra base por jogo

Para cada jogo finalizado, o app compara o placar real com o palpite do participante.

Ordem atual de avaliacao:

| Situacao | Pontos base |
| --- | ---: |
| Placar exato | 10 |
| Acertou o vencedor e o saldo de gols | 6 |
| Acertou o vencedor e os gols de um time | 5 |
| Acertou empate, mas nao o placar exato | 5 |
| Acertou apenas o vencedor e o total de gols da partida | 5 |
| Acertou apenas o vencedor | 4 |
| Acertou apenas o total de gols da partida | 1 |
| Nao acertou nada | 0 |

Resultado significa:

- vitoria do time A;
- empate;
- vitoria do time B.

Saldo de gols significa:

```text
gols do time A - gols do time B
```

Total de gols da partida significa:

```text
gols do time A + gols do time B
```

## Empates

Empate nao exato tem regra propria: vale sempre 5 pontos.

Isso evita a regra antiga em que todo empate nao exato tambem acertava o saldo, ja que todo empate tem saldo zero.

Exemplos:

| Placar real | Palpite | Situacao | Pontos base |
| --- | --- | --- | ---: |
| 1 x 1 | 1 x 1 | Placar exato | 10 + bonus raro |
| 1 x 1 | 0 x 0 | Empate nao exato | 5 |
| 1 x 1 | 2 x 2 | Empate nao exato | 5 |
| 2 x 2 | 3 x 3 | Empate nao exato | 5 |
| 1 x 1 | 2 x 0 | Total de gols, sem resultado | 1 |

## Jogos com vencedor

Exemplo com placar real:

```text
Brasil 2 x 1 Franca
```

| Palpite | Situacao | Pontos base |
| --- | --- | ---: |
| 2 x 1 | Placar exato | 10 + bonus raro |
| 3 x 2 | Vencedor + saldo | 6 |
| 2 x 0 | Vencedor + gols de um time | 5 |
| 3 x 0 | Apenas vencedor + total de gols | 5 |
| 4 x 2 | Apenas vencedor | 4 |
| 1 x 2 | Total de gols, sem resultado | 1 |
| 0 x 2 | Errou tudo | 0 |

Observacoes:

- Acertar o vencedor vale 4 pontos; se tambem acertar os gols de um time, soma 1 ponto e vira 5.
- O ponto por total de gols nao entra em placar exato.
- O ponto por total de gols so soma como extra no caso de "apenas vencedor".
- Se a pessoa erra o resultado, mas acerta o total de gols da partida, recebe 1 ponto.
- Acertar os gols de um time sem acertar o resultado nao pontua mais sozinho.

## Bonus por placar exato raro

Quando o participante acerta o placar exato, alem dos 10 pontos base, pode receber um bonus de raridade.

O bonus usa o placar de forma normalizada, sempre colocando o maior numero primeiro. Por exemplo:

```text
Brasil 3 x 1 Franca
Franca 1 x 3 Brasil
```

Ambos usam a mesma chave:

```text
3 x 1
```

Tabela atual de bonus:

| Placar | Bonus |
| --- | ---: |
| 1 x 1, 1 x 0, 0 x 0, 2 x 1 | 0 |
| 2 x 0, 2 x 2 | 1 |
| 3 x 1, 3 x 0, 3 x 2 | 2 |
| 4 x 0, 4 x 1, 3 x 3 | 3 |
| 4 x 2, 5 x 0, 5 x 1 | 4 |
| 4 x 3, 6 x 0, 5 x 2, 6 x 1, 7 x 0, 4 x 4, 5 x 3, 6 x 2, 7 x 1, 8 x 0, 9 x 0, 8 x 1, 5 x 4, 7 x 2, 6 x 3 | 5 |
| Qualquer outro placar exato nao listado | 5 |

## Multiplicador por fase

Depois de calcular os pontos base e o bonus de placar exato raro, o app aplica o multiplicador do jogo.

Formula atual:

```text
pontos finais = piso((pontos base + bonus raro) * multiplicador)
```

O app usa `Math.floor`, ou seja, arredonda para baixo.

Exemplo com multiplicador 1.2:

```text
(10 + 2) * 1.2 = 14.4
pontos finais = 14
```

## Pontuacao de classificado no mata-mata

Atualmente nao existe bonus de classificado.

O app nao pede mais para escolher quem passa de fase, e o calculo atual nao soma pontos por classificado.
