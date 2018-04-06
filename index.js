const fetch =
  (typeof window === "object" && window.fetch) || require("node-fetch")
const pathToRegexp = require("path-to-regexp")

const parseUrl = url => {
  let origin = ""
  let pathname = ""
  if (url.indexOf("://") > -1) {
    const res = url.match("(^(?:(?:.*?)?//)?[^/?#;]*)(.*)")
    origin = res[1]
    pathname = res[2]
  } else {
    pathname = url
  }
  return { origin, pathname }
}

const compilePath = (url, params) => pathToRegexp.compile(url)(params)

const uriReducer = (res = [], [key, val]) =>
  res.concat(
    Array.isArray(val)
      ? val.reduce((res, val, i) => uriReducer(res, [`${key}[]`, val]), [])
      : typeof val === "object"
        ? Object.entries(val).reduce(
            (res, [i, val]) => uriReducer(res, [`${key}[${i}]`, val]),
            []
          )
        : `${encodeURIComponent(key)}=${encodeURIComponent(val)}`
  )

const withQuestion = res => (res.length && `?${res}`) || ""

const buildQueryString = payload =>
  withQuestion(
    typeof payload === "string"
      ? payload
      : Object.entries(payload)
          .reduce(uriReducer, [])
          .join("&")
  )

const defaultStatusValidator = status => status >= 200 && status < 300

const prepareBody = body =>
  body instanceof FormData
    ? body
    : typeof body === "object" ? JSON.stringify(body) : body

const createResponse = res => body => ({
  status: res.status,
  headers: res.headers,
  body: body
})

export default {
  createState: () => ({
    status: null,
    headers: null,
    body: null
  }),

  callback({ payload, resolve, reject, setCancelCallback }) {
    if (payload.controller) {
      setCancelCallback(payload.controller.abort)
    }

    const cbs = { resolve, reject }

    const done = res => {
      const isValid = payload.validateStatus(res.status)
      const responseWith = createResponse(res)

      const stream = res.clone()

      const parser = payload.parser[isValid ? "done" : "fail"]
      const callback = isValid ? "resolve" : "reject"

      return stream[parser]()
        .then(body => cbs[callback](responseWith(body)))
        .catch(() => res.text().then(body => cbs[callback](responseWith(body))))
    }

    const fail = err => {
      throw err
    }

    return fetch(payload.url, payload.options)
      .then(done)
      .catch(function(err) {
        if (err.name === "AbortError") return
        fail(err)
      })
  },

  convert(payload) {
    let controller
    try {
      /* eslint-disable no-undef */
      controller = new AbortController()
      /* eslint-enable no-undef */
    } catch (err) {}
    const { origin, pathname } = parseUrl(payload.url)
    const res = {
      url: origin + compilePath(pathname, payload.params || {}),
      parser: (payload.parser &&
        (typeof payload.parser === "string"
          ? { done: payload.parser, fail: payload.parser }
          : payload.parser)) || { done: "json", fail: "json" },
      controller: controller,
      validateStatus: payload.validateStatus || defaultStatusValidator,
      options: {
        method: payload.method || "GET",
        headers: payload.headers || {},
        credentials: payload.createntials || "omit"
      }
    }
    if (payload.query) {
      res.url += buildQueryString(payload.query)
    }
    if (payload.body) {
      res.options.body = (payload.prepareBody || prepareBody)(payload.body)
    }
    if (
      typeof payload.body === "object" &&
      !(payload.body instanceof FormData)
    ) {
      res.options.headers["Content-Type"] = "application/json"
    }
    if (controller) {
      res.options.signal = controller.signal
    }
    return res
  },

  merge(from, to) {
    const res = Object.assign({}, from, to)
    if (to.url !== undefined && from.url !== undefined) {
      res.url = to.url[0] === "/" ? to.url : [from.url, to.url].join("/")
    }
    return res
  }
}
