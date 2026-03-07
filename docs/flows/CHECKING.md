# Flows — Verificações pendentes no Simplo

## Última execução completa: 2026-03-20

Todos os 10 flows testados com **pagamentos reais** (cartões de teste Cielo via checkout do Simplo, sem webhooks simulados).

---

## Resultados por flow

| Flow | Descrição | Resultado | Webhooks recebidos |
|------|-----------|-----------|-------------------|
| 1 | Customer + Trial (Filtrado R$29,90) | **PARTIAL** | `charge.created` ✓ / `invoice.paid` ✗ |
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

## Flow 1 — Trial: `invoice.paid` não chegou

**O que aconteceu**: checkout com trial criado (Filtrado R$29,90, 100% desconto no 1o ciclo). Pagamento feito na URL do Simplo. O webhook `charge.created` chegou, mas `invoice.paid` **não chegou**. A subscription ficou `pending` localmente.

**Verificação direta na API do Simplo**: subscription está `active` no Simplo. O pagamento foi processado — o webhook é que não foi entregue.

**Dados do teste**:
- Org: `199de211-8121-4aa2-9a0d-89c016ddbb06`
- Subscription (Simplo): `019d0d40-897d-7518-b47e-616b6be38004`
- Customer (Simplo): `019d0d40-7588-7edf-861d-29adf30b3495`

---

## Flow 9 — Refund agora funciona

Na execução anterior, refunds retornavam 502 `REFUND_SYSTEM_ERROR`. Nesta execução, o refund real funcionou:

```json
{
  "id": "019d0d40-8a97-77d3-ac48-8cc233bf4c8e",
  "object": "refund",
  "amount": 2990,
  "status": "refunded"
}
```

O `payment_intent` foi obtido da tabela `charge` do banco local (preenchida pelo webhook `charge.created`).

---

## Flow 10 — `charge.rejected` não chegou

**O que aconteceu**: checkout criado (Snack Box R$24,90). Pagamento tentado com cartão Cielo de teste final 2 (não autorizado). O checkout do Simplo mostrou erro de cartão — a rejeição funcionou. Porém, o webhook `charge.rejected` **não chegou**. Apenas `charge.created` chegou.

**Dados do teste**:
- Subscription (Simplo): `019d0d4f-68f6-7406-aae3-98afb6690f9e`
- Cartão usado: `4054 7085 6502 6122` (Luhn válido, final 2 = não autorizado Cielo)
- Status local: `pending`

**Conclusão**: o Simplo parece não enviar `charge.rejected` para falhas no primeiro checkout. O webhook provavelmente é enviado apenas para falhas em **cobranças recorrentes** (retry automático de faturas).

---

## Padrão confirmado (2 execuções)

| Webhook | Compras avulsas | Assinaturas (1o pagamento) | Observação |
|---------|----------------|---------------------------|------------|
| `invoice.created` | ✓ chega | ✓ chega | Consistente |
| `invoice.paid` | ✓ chega | ⚠️ inconsistente | Não chegou para trial (Flow 1), chegou para promo (Flow 6) e plan change (Flow 8) |
| `charge.created` | ✓ chega | ✓ chega | Consistente |
| `charge.rejected` | N/A | ✗ não chega | Simplo só envia para cobranças recorrentes? |
| `charge.refunded` | ✓ chega | ✓ chega | Confirmado nesta execução |

**Webhooks confiáveis**: `invoice.created`, `charge.created`, `charge.refunded`
**Webhooks inconsistentes**: `invoice.paid` (para trials), `charge.rejected` (para checkout)
