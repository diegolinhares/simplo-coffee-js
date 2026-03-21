# Flows — Verificações pendentes no Simplo

## Última execução completa: 2026-03-20 (2a rodada)

Todos os 6 checkouts do Flow 1 testados com pagamentos reais (cartões de teste Cielo via checkout do Simplo). Tunnel ngrok ativo com webhooks chegando.

---

## Resultados por flow

| Flow | Descrição | Resultado | Webhooks recebidos |
|------|-----------|-----------|-------------------|
| 1A | Hosted checkout (Filtrado R$29,90) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ |
| 1B | Transparente 50% off (Barista R$49,95) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ |
| 1C | Transparente R$10 off (Filtrado R$19,90) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ |
| 1D | Transparente 100% trial (Filtrado R$0) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ (R$0) |
| 1E | Invoice URL 50% off (Barista R$49,95) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ |
| 1F | Invoice URL 100% off (Filtrado R$0) | **PASSED** | `charge.created` ✓ / `invoice.paid` ✓ (R$0) |
| 2 | Cancel Subscription | **PASSED** | N/A |
| 3 | Update Customer | **PASSED** | N/A |
| 4 | Billing History | **PASSED** | N/A |
| 5 | One-time Purchase (Caneca R$79,90) | **PASSED** | `invoice.created` ✓ / `invoice.paid` ✓ |
| 6 | Promo Discount (50% off Barista) | **PASSED** | `invoice.paid` ✓ → sub `active` |
| 7 | Bundle (Kit + 2 Canecas = R$309,70) | **PASSED** | `invoice.created` ✓ / `invoice.paid` ✓ |
| 8 | Plan Change (Barista → Espresso) | **PASSED** | `invoice.paid` ✓ → nova sub `active` |
| 9 | Refund (real, R$29,90) | **PASSED** | `charge.refunded` ✓ |
| 10 | Payment Failure (cartão rejeitado) | **PARTIAL** | `charge.created` ✓ / `charge.rejected` ✗ |

---

## Correção: 100% off ENVIA webhooks

Na 1a rodada, o `invoice.paid` não chegou para trials e o doc dizia "Nenhum webhook é enviado". Na 2a rodada, com tunnel ngrok funcionando, confirmamos que o Simplo **envia** `charge.created` e `invoice.paid` para 100% off (amount R$0), tanto no checkout transparente (1D) quanto no hosted via invoice URL (1F).

O Simplo auto-completa a invoice de R$0 na criação da subscription, então a app salva como `active` direto sem depender dos webhooks. Eles chegam como confirmação redundante.

O doc `1_create_customer_with_discounts.md` foi atualizado para refletir isso.

---

## Bug corrigido: updateCustomer ignorava resultado

O serviço `CreateTransparentCheckout` chamava `simplo.updateCustomer()` para setar o phone do customer antes do checkout, mas não verificava o resultado. Se o phone fosse inválido ou duplicado no Simplo, o update falhava silenciosamente e o checkout retornava o erro confuso `"Customer phone não pode ficar em branco"`.

Corrigido: agora o serviço verifica o resultado e retorna `Err` com `reason: "simplo_error"` se o update falhar. Teste adicionado cobrindo phone duplicado (422 do Simplo).

---

## Descobertas da 2a rodada

- `phone` é obrigatório no checkout transparente, formato `+55DDNNNNNNNNN`
- `phone` deve ser único por customer no Simplo
- Nomes com acentos podem ser rejeitados no `card_holder_name` (o serviço aplica `stripAccents`)
- O CPF usado no `identifier` da org deve ser válido (Simplo valida dígito verificador) e único

---

## Flow 10 — `charge.rejected` não chegou

**O que aconteceu**: checkout criado (Snack Box R$24,90). Pagamento tentado com cartão Cielo de teste final 2 (não autorizado). O checkout do Simplo mostrou erro de cartão — a rejeição funcionou. Porém, o webhook `charge.rejected` **não chegou**. Apenas `charge.created` chegou.

**Dados do teste**:
- Subscription (Simplo): `019d0d4f-68f6-7406-aae3-98afb6690f9e`
- Cartão usado: `4054 7085 6502 6122` (Luhn válido, final 2 = não autorizado Cielo)
- Status local: `pending`

**Conclusão**: o Simplo parece não enviar `charge.rejected` para falhas no primeiro checkout. O webhook provavelmente é enviado apenas para falhas em cobranças recorrentes (retry automático de faturas).

---

## Padrão confirmado (2 execuções)

| Webhook | Compras avulsas | Assinaturas (1o pagamento) | 100% off (trial) | Observação |
|---------|----------------|---------------------------|-------------------|------------|
| `invoice.created` | ✓ chega | ✓ chega | não testado | Consistente |
| `invoice.paid` | ✓ chega | ✓ chega | ✓ chega (R$0) | Corrigido na 2a rodada |
| `charge.created` | ✓ chega | ✓ chega | ✓ chega (R$0) | Consistente |
| `charge.rejected` | N/A | ✗ não chega | N/A | Só para cobranças recorrentes? |
| `charge.refunded` | ✓ chega | ✓ chega | N/A | Confirmado |

**Webhooks confiáveis**: `invoice.created`, `invoice.paid`, `charge.created`, `charge.refunded`
**Webhooks inconsistentes**: `charge.rejected` (para checkout, não para cobranças recorrentes)
