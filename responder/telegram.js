require("./helper")
const api = require("axios").create({
  baseURL: "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN,
})
const ShoppingItem = require("../model/shopping-item")
const regression = require("regression")
const BOT_USERNAME = process.env.BOT_USERNAME

const respond = (body) => {
  let response = Promise.resolve()
  const message = body.message
  if (message && message.text) {
    message.text.split("\n").forEach((line) => {
      response = response
        .then(() => respondText(message, line))
        .then(text => text ? sendMessage(message, text).then(() => text) : text)
        .then(text => needToSendAnimation(text) ? sendAnimation(message) : undefined)
    })
  }
  return response
}

const respondText = (message, text) => {
  if (text == "/start") return start()
  if (text == "/rangkuman" || text == "/rangkuman@" + BOT_USERNAME) return summary(message)
  if (text == "/hariini" || text == "/hariini@" + BOT_USERNAME) return listToday(message)
  if (text == "/kemarin" || text == "/kemarin@" + BOT_USERNAME) return listYesterday(message)
  if (text == "/pekanini" || text == "/pekanini@" + BOT_USERNAME) return listThisWeek(message)
  if (text == "/pekanlalu" || text == "/pekanlalu@" + BOT_USERNAME) return listPastWeek(message)
  if (text == "/bulanini" || text == "/bulanini@" + BOT_USERNAME) return listThisMonth(message)
  if (text == "/bulanlalu" || text == "/bulanlalu@" + BOT_USERNAME) return listPastMonth(message)
  if (text == "/gakjadi" || text == "/gakjadi@" + BOT_USERNAME) return undo(message)
  if (text == "/total" || text == "/total@" + BOT_USERNAME) return sum(message)

  const shoppingText = getShoppingText(text)
  if (shoppingText) return createNewShopping(message, shoppingText)

  if (isMentioned(message)) return replyMention()
  return Promise.resolve()
}

const sendMessage = (message, text, replyTo) =>
  api.post("/sendMessage", {
    chat_id: message.chat.id,
    text: text,
    parse_mode: "Markdown",
    reply_to_message_id: replyTo,
  })

const sendAnimation = message =>
  api.post("/sendAnimation", {
    chat_id: message.chat.id,
    animation: [
      "CgADBAADqI8AAhEdZAeLdJSml8QYUgI",
      "CgADBAADiJ8AAuoZZAe4oaNOLDWZCQI",
      "CgADBAAD2qAAAmQdZAc8GCctmsou4AI",
    ].sample(),
  })

const needToSendAnimation = text => text && text.endsWith("😱") && Math.random() > 0.5

/* START */
const start = () =>
  Promise.resolve(`*Cara Catatan Belanja Membantu Anda*
- Undang @catatan\\_belanja\\_bot ke grup Telegram keluarga anda
- Bot otomatis mencatat pengeluaran Anda, ketika ada pesan seperti
  - belanja bahan masakan 45.000
  - bayar tagihan listrik 200 k
  - beli baju lebaran 1,5jt
  - tadi beli jus jambu 8rb, enak banget 😆
- Bot juga memiliki beberapa perintah, yaitu
  - /rangkuman: rangkuman catatan belanja
  - /hariini: daftar belanjaan hari ini
  - /kemarin: daftar belanjaan kemarin
  - /pekanini: daftar belanjaan pekan ini
  - /pekanlalu: daftar belanjaan pekan lalu
  - /bulanini: daftar belanjaan bulan ini
  - /bulanlalu: daftar belanjaan bulan lalu
  - /gakjadi: ⚠ menghapus 1 catatan terakhir`)


/* NEW SHOPPING ITEM */
const getShoppingText = (text) => {
  text = text.replace(/\d(\.\d{3})+/g, phrase => phrase.replace(/\./g, ""))
  text = text.replace(/\d,\d/g, phrase => phrase.replace(",", "."))
  text = text.replace(/\d+(\.\d+)?\s*(k|rb|ribu)\b/gi, phrase => phrase.match(/\d+(\.\d+)?/)[0] * 1000)
  text = text.replace(/\d+(\.\d+)?\s*(jt|juta)\b/gi, phrase => phrase.match(/\d+(\.\d+)?/)[0] * 1000 * 1000)
  text = text.replace(/seribu/gi, 1000)
  const match = text.match(/(belanja|beli|bayar)\s+.*\w.*\s+\d{3,10}/i)
  return match ? match[0] : ""
}

const OK_MSGS = [
  "oke bos. sudah dicatat 👌",
  "dicatat bos 👌",
  "siap bos. dicatat ya 👌",
]
const createNewShopping = (message, shoppingText) => {
  const owner = message.chat.id
  const words = shoppingText.split(/\s+/)
  const name = words.slice(1, -1).join(" ")
  const price = Number(words[words.length - 1])
  return new ShoppingItem({ owner, name, price }).save()
    .then(() => getShock(owner, price).catch(error => console.error(error) || ""))
    .then(shock => `${OK_MSGS.sample()}\n*${name} ${price.pretty()}*${shock}`)
    .catch(error => console.error(error) || `wah, piye iki? ${name} gagal dicatat 🙏`)
}

const getShock = (owner, price) =>
  ShoppingItem.pastDays(owner, 15).then((pastItems) => {
    if (pastItems.length == 0) return ""
    const avg = pastItems.sumBy("price") / pastItems.length
    const repeat = Math.max(0, Math.round(Math.log(price / avg)))
    return repeat ? "? " + "😱".repeat(repeat) : ""
  })


/* SUMMARY */
const summary = (message) => {
  const owner = message.chat.id
  return Promise.all([
    ShoppingItem.today(owner),
    ShoppingItem.yesterday(owner),
    ShoppingItem.thisWeek(owner),
    ShoppingItem.pastWeek(owner),
    ShoppingItem.thisMonth(owner),
    ShoppingItem.pastMonth(owner),
    ShoppingItem.pastDays(owner, 15),
  ]).then(([todayItems, yesterdayItems, thisWeekItems, pastWeekItems, thisMonthItems, pastMonthItems, pastItems]) => {
    const [todayPrediction, tomorrowPrediction] = predict(pastItems, 2)
    return [
      "*== RANGKUMAN TOTAL BELANJA ==*",
      "",
      `Hari ini: ${todayItems.sumBy("price").pretty()}`,
      `Kemarin: ${yesterdayItems.sumBy("price").pretty()}`,
      "",
      `Pekan ini: ${thisWeekItems.sumBy("price").pretty()}`,
      `Pekan lalu: ${pastWeekItems.sumBy("price").pretty()}`,
      "",
      `Bulan ini: ${thisMonthItems.sumBy("price").pretty()}`,
      `Bulan lalu: ${pastMonthItems.sumBy("price").pretty()}`,
      "",
      isNaN(todayPrediction) ? "" : `_Hari ini mungkin ${todayPrediction.pretty()}..._`,
      isNaN(tomorrowPrediction) ? "" : `_dan besok mungkin ${tomorrowPrediction.pretty()}_`,
    ].join("\n").trim()
  })
}

const predict = (items, n) => {
  const data = items.reduce(perDay, []).map((reducedItem, i) => [
    i,
    reducedItem.price,
  ])
  const predictor = regression.polynomial(data, { order: 3 })
  return range(data.length, data.length + n).map(x => Math.round(predictor.predict(x)[1] / 1000) * 1000)
}

const range = (a, b) => Array.from(Array(b - a).keys()).map(x => x + a)

const perDay = (acc, item) => {
  const itemDate = item.createdAt.getDate()
  if (acc.length && acc[acc.length - 1].date == itemDate) {
    acc[acc.length - 1].price += item.price
  } else {
    acc.push({ date: itemDate, price: item.price })
  }
  return acc
}


/* LIST */
const listToday = message =>
  ShoppingItem
    .today(message.chat.id)
    .then(items => formatItems("*== BELANJAAN HARI INI ==*", items))

const listYesterday = message =>
  ShoppingItem
    .yesterday(message.chat.id)
    .then(items => formatItems("*== BELANJAAN KEMARIN ==*", items))

const listThisWeek = message =>
  ShoppingItem
    .thisWeek(message.chat.id)
    .then(items => formatItems("*== BELANJAAN PEKAN INI ==*", items))

const listPastWeek = message =>
  ShoppingItem
    .pastWeek(message.chat.id)
    .then(items => formatItems("*== BELANJAAN PEKAN LALU ==*", items))

const listThisMonth = message =>
  ShoppingItem
    .thisMonth(message.chat.id)
    .then(items => formatItems("*== BELANJAAN BULAN INI ==*", items))

const listPastMonth = message =>
  ShoppingItem
    .pastMonth(message.chat.id)
    .then(items => formatItems("*== BELANJAAN BULAN LALU ==*", items))

const formatItems = (title, items) =>
  [title]
    .concat(items.map((item, i) =>
      (i == 0 || items[i - 1].createdAt.getDate() != items[i].createdAt.getDate() ? `\n${item.createdAt.simple()}\n` : "") +
    `- ${item.name} (${item.price.pretty()})`))
    .concat(["", `*TOTAL: ${items.sumBy("price").pretty()}*`])
    .join("\n")


/* UNDO */
const undo = message =>
  ShoppingItem
    .lastItem(message.chat.id)
    .then(lastItem => lastItem ? lastItem.remove().then(lastItem => `*${lastItem.name}* gak jadi dicatat bos`) : undefined)


/* SUM */
const sum = message =>
  ShoppingItem
    .all(message.chat.id)
    .then(items => `*TOTAL: ${items.sumBy("price").pretty()}*`)


/* MENTION */
const isMentioned = message =>
  message.text.match(/\bbo(t|s)\b/i) ||
  message.text.toLowerCase().includes("@" + BOT_USERNAME) ||
  (message.reply_to_message && message.reply_to_message.from.username == BOT_USERNAME)

const MENTIONED_MSGS = [
  "ngomong apa to bos?",
  "mbuh bos, gak ngerti",
  "aku orak paham boooss 😔",
]
const replyMention = () => Promise.resolve(MENTIONED_MSGS.sample())

module.exports = respond
