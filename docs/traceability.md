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
| AC-13 | «Зʼїдений» залишком купон → `not_applicable`, applied без нулів (D-15) | `discounts.ts:priceOrder` (`granted <= 0` → reject) | `AC-13: coupon eaten by an exhausted remainder — rejected 'not_applicable', never applied with 0` | ✅ |
| AC-14 | `expiresAt` без зсуву/сміття → `expired` незалежно від TZ (D-16) | `discounts.ts:expiresAtMs` (`ISO_INSTANT`) | `AC-14: offset-less or malformed expiresAt — rejected 'expired' regardless of TZ` | ✅ |
| AC-15 | Інший регістр коду → `unknown`, строге `===` (D-17) | `discounts.ts:priceOrder` (`catalog.find`, строге порівняння) | `AC-15: case mismatch — 'save10' vs catalog 'SAVE10' is 'unknown'` | ✅ |

## Зворотна перевірка

- **Чи є в коді поведінка, якої немає в жодному AC?**
  Знайдено одну (стан на Task C, **історичний** — див. оновлення нижче): за
  тодішнім D-7 купон після вичерпання залишку **застосовувався з сумою 0**
  (а не відхилявся) — рішення було записане в спеці, але жоден AC його не
  закріплював, і тест на це не з'явився б сам. Тоді виправлено додаванням
  тесту `D-7: coupon after the remainder is exhausted applies with 0` (AC у
  спеку не дописувався). Після рецензії Task E ця поведінка **змінена на
  протилежну** рішенням D-15: такий купон відхиляється з `not_applicable`, і
  це тримає тест AC-13. Іншої «ініціативи» в коді немає: кожна гілка
  `discounts.ts` виводиться з D-1…D-17.
- **Чи є AC без тесту?** Немає — усі 15 у таблиці, назви тестів збігаються з ID.
- **Чи є тест, який не мапиться на жоден AC?** Сім, усі навмисні — вони
  закріплюють граничні формулювання рішень, що мають нормативний текст у
  спеці, але не мають власного AC (частину з них як прогалину назвала рецензія
  Task E, SA-4/SA-6/SA-7): `D-11` (межа `now === expiresAt`), `D-16` (валідний
  явний зсув `+02:00`), `D-6` (провальна гілка `min_subtotal_not_met`),
  `D-12` (відсутня категорія), `D-4` (пів копійки для відсоткового купона),
  `D-13` (кап фіксованого купона об суму категорії) та інваріантний тест
  breakdown-а (кожен код рівно в одному зі списків).

> **Оновлення 2026-09-21 (після рецензії Task E).** Панель BA/SA/Architect
> знайшла, що місце зі зворотної перевірки — «купон після вичерпання залишку
> дає 0» — було не просто недотестоване, а суперечило обґрунтуванню D-12.
> Спека тепер вирішує це явно: рішення **D-15** (такий купон відхиляється з
> `not_applicable`, applied без нулів) з власним **AC-13**; колишній тест
> `D-7: … applies with 0` замінено на AC-13-тест із протилежним очікуванням.
> Разом із D-16 (формат `expiresAt`) і D-17 (строге порівняння кодів)
> реалізацію й тести вирівняно під спеку: 15 AC-тестів + 7 граничних, 30
> зелених разом із наявними у `pricing.test.ts`.

## Що з цього вийшло

Зворотна перевірка знайшла одну реальну розбіжність: тодішнє рішення D-7 про
«купон із нульовою знижкою після вичерпання залишку» жило тільки в тексті
спеки — код його реалізовував, але жоден тест не тримав (нині це місце
перевирішене: D-15/AC-13, купон відхиляється — див. оновлення вище).
Специфікацію на етапі Task C правити не довелося: всі 14 тодішніх розвилок
з Task A витримали зустріч із кодом, що
скоріше говорить про те, що фіча невелика і добре продумана на папері, ніж
про те, що так буде завжди. Висновок: «один тест на один AC» — необхідний
мінімум, але граничні формулювання всередині рішень (D-7, D-11, D-12) теж
потребують по тесту, інакше вони — неперевірені обіцянки.
