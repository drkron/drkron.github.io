export const logi = (...args) => {
  console.log(...args);
}

export const logw = (...args) => {
  console.warn(...args);
}

export const prettyJson = (obj) => JSON.stringify(obj, null, 2);