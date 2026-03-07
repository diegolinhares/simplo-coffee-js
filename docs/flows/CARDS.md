# Cartões de Teste — Cielo Sandbox

## Regra de geração

Os números de cartão devem:

1. **Passar na validação Luhn** — o checkout do Simplo valida o cartão antes de enviar para a Cielo. Números aleatórios são rejeitados com "Número do cartão não é válido".
2. **Terminar com o dígito correspondente ao status desejado** — o último dígito define o resultado da transação.

Os 15 primeiros dígitos podem ser qualquer sequência que resulte em um número Luhn-válido. CVV (3 dígitos) e validade (qualquer data futura) podem ser aleatórios.

### Como gerar um cartão Luhn-válido

```python
import random

def gerar_cartao_visa(final: int) -> str:
    """Gera um cartão Visa (16 dígitos) válido pelo Luhn com o final desejado."""
    while True:
        prefix = "4"
        middle = "".join([str(random.randint(0, 9)) for _ in range(14)])
        card = prefix + middle + str(final)
        # Validação Luhn
        digits = [int(d) for d in card]
        odd = digits[-1::-2]
        even = digits[-2::-2]
        total = sum(odd) + sum(sum(divmod(d * 2, 10)) for d in even)
        if total % 10 == 0:
            return " ".join([card[i:i+4] for i in range(0, 16, 4)])
```

---

## Tabela de cartões por status

| Final | Status | Código | Mensagem | Quando usar |
|-------|--------|--------|----------|-------------|
| 0 | Autorizado | 4 | Operação realizada com sucesso | Pagamento normal (aprovado) |
| 1 | Autorizado | 6 | Operação realizada com sucesso | Pagamento normal (aprovado) |
| 2 | **Não autorizado** | 05 | Não autorizada | **Flow 10** — testar falha de pagamento |
| 3 | **Não autorizado** | 57 | Cartão expirado | Testar cartão vencido |
| 4 | Autorizado | 4 | Operação realizada com sucesso | Pagamento normal (aprovado) |
| 5 | **Não autorizado** | 78 | Cartão bloqueado | Testar cartão bloqueado |
| 6 | **Não autorizado** | 99 | Timeout | Testar timeout da operadora |
| 7 | **Não autorizado** | 77 | Cartão cancelado | Testar cartão cancelado |
| 8 | **Não autorizado** | 70 | Problemas com o cartão de crédito | Testar erro genérico |
| 9 | Aleatória | 6 ou 9 | Sucesso ou timeout | Resultado imprevisível — evitar em testes |

---

## Cartões pré-gerados (Luhn-válidos)

### Para pagamento aprovado (final 0)

```
4710 1220 4697 4700
```

### Para rejeição (final 2 — "Não autorizada")

```
4054 7085 6502 6122
```

### Para cartão expirado (final 3 — "Cartão expirado")

```
4382 9099 7591 0573
```

### Para cartão bloqueado (final 5 — "Cartão bloqueado")

```
4141 1504 5246 1945
```

### Para timeout (final 6 — "Timeout")

```
4908 3449 8502 4436
```

### Para cartão cancelado (final 7 — "Cartão cancelado")

```
4110 3229 4586 4467
```

### Para erro genérico (final 8 — "Problemas com o cartão")

```
4210 7685 0345 4258
```

> Todos validados com Luhn. Se precisar de novos, use o script acima.

---

## Dados complementares para o checkout

| Campo | Valor |
|-------|-------|
| Validade | Qualquer data futura (ex: `05/28`) |
| CVV | Qualquer 3 dígitos (ex: `211`) |
| Nome do titular | Qualquer nome |
| CPF | Deve ser válido (ex: `529.982.247-25`) |

---

## Bandeiras suportadas

| Bandeira | Prefixo | Dígitos |
|----------|---------|---------|
| Visa | 4 | 16 |
| Mastercard | 51-55 ou 2221-2720 | 16 |
| Amex | 34 ou 37 | 15 |

> Os exemplos acima são todos Visa (prefixo 4). Para Mastercard, ajuste o prefixo no script.

---

## Referência

- [Cielo — Cartão de crédito em sandbox](https://docs.cielo.com.br/ecommerce-cielo/reference/credito-sandbox)
