# Простежуваність: spec → code → tests (Task C)

**Специфікація:** `docs/spec/pricing-discounts.md`
**Реалізація:** `app/src/discounts.ts`
**Тести:** `app/src/discounts.test.ts`

## Таблиця

| AC | Що перевіряє | Де реалізовано (файл:символ) | Тест (назва) | Статус |
|---|---|---|---|---|
| AC-1 | Gold 10% від subtotal, доставка не чіпається | `discounts.ts:priceOrder` (tierDiscount) | `AC-1: Gold, no coupons — tier 10% of subtotal, shipping untouched` | ✅ |
| AC-2 | Прострочений купон → `expired`, без винятку | `discounts.ts:rejectionReason` | `AC-2: expired coupon — rejected with reason 'expired', no throw` | ✅ |
| AC-3 | Два купони на одну категорію, кожен від суми категорії | `discounts.ts:categorySumKopecks` + fold у `priceOrder` | `AC-3: two coupons on the same category — each from the category sum` | ✅ |
| AC-4 | Фіксований купон більший за subtotal → урізається | `discounts.ts:priceOrder` (`min(nominal, base, remainder)`) | `AC-4: fixed coupon larger than subtotal — truncated, goods part not negative` | ✅ |
| AC-5 | Адитивність: рівень + купон, кожен від повної бази | `discounts.ts:priceOrder` (tierDiscount + fold) | `AC-5: tier and coupon are additive, each from the full subtotal` | ✅ |
| AC-6 | Пів копійки округлюється вгору | `discounts.ts:roundHalfUp` | `AC-6: half a kopeck rounds up — Silver 5% of 9 990 is 500` | ✅ |
| AC-7 | Порожнє замовлення — нулі, купон відхилено, не помилка | `discounts.ts:priceOrder` + `rejectionReason` (`not_applicable`) | `AC-7: empty order — zeros everywhere, coupon rejected, no error` | ✅ |
| AC-8 | `minSubtotalKopecks` перевіряється до знижок | `discounts.ts:rejectionReason` (`min_subtotal_not_met` проти `subtotal`) | `AC-8: minSubtotal checked before discounts — 50 000 passes despite tier` | ✅ |
| AC-9 | Відсотковий + фіксований разом, у порядку введення | `discounts.ts:priceOrder` (fold по `order.coupons`) | `AC-9: percent and fixed coupons both apply, in typed order` | ✅ |
| AC-10 | Дубль коду → друге входження `duplicate` | `discounts.ts:rejectionReason` (`seenCodes`) | `AC-10: same code twice — second entry rejected as 'duplicate'` | ✅ |
| AC-11 | Невідомий код → `unknown`, валідний поруч працює | `discounts.ts:rejectionReason` (`unknown`) | `AC-11: unknown code rejected, valid one still applies` | ✅ |
| AC-12 | Digital-замовлення: кап по залишку, доставка 0, total 0 | `discounts.ts:priceOrder` (`remainder`) + `pricing.ts:shippingKopecks` | `AC-12: digital order fully discounted — coupon capped, shipping never eaten` | ✅ |

## Зворотна перевірка

- **Чи є в коді поведінка, якої немає в жодному AC?**
  Знайдено одну: за D-7 купон після вичерпання залишку **застосовується з
  сумою 0** (а не відхиляється) — рішення записане в спеці, але жоден AC його
  не закріплював, і тест на це не з'явився б сам. Виправлено додаванням тесту
  `D-7: coupon after the remainder is exhausted applies with 0` (AC у спеку не
  дописував — поведінка вже зафіксована в D-7, бракувало лише тесту).
  Іншої «ініціативи» в коді немає: кожна гілка `discounts.ts` виводиться з
  D-1…D-14.
- **Чи є AC без тесту?** Немає — усі 12 у таблиці, назви тестів збігаються з ID.
- **Чи є тест, який не мапиться на жоден AC?** Три, всі навмисні:
  1. `category coupon on absent category …` — сценарій D-12 з дельта-спеки
     OpenSpec (категорії немає в замовленні → `not_applicable`);
  2. `expiry boundary …` — межа D-11 (`now === expiresAt` → `expired`);
  3. `D-7: coupon after the remainder is exhausted …` — знахідка зворотної
     перевірки, див. вище.
  Вони закріплюють рішення D-7/D-11/D-12, які мають нормативний текст у спеці,
  але не мають власного AC.

## Що з цього вийшло

Зворотна перевірка знайшла одну реальну розбіжність: рішення D-7 про «купон
із нульовою знижкою після вичерпання залишку» жило тільки в тексті спеки —
код його реалізовував, але жоден тест не тримав. Тепер тримає. Специфікацію
правити не довелося: всі 14 розвилок з Task A витримали зустріч із кодом, що
скоріше говорить про те, що фіча невелика і добре продумана на папері, ніж
про те, що так буде завжди. Висновок: «один тест на один AC» — необхідний
мінімум, але граничні формулювання всередині рішень (D-7, D-11, D-12) теж
потребують по тесту, інакше вони — неперевірені обіцянки.
