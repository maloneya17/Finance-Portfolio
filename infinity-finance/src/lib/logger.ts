type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, prefix: string, message: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    prefix,
    message,
    timestamp: new Date().toISOString(),
    ...(data ? { data } : {}),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const logger = {
  info:  (prefix: string, message: string, data?: Record<string, unknown>) => log('info',  prefix, message, data),
  warn:  (prefix: string, message: string, data?: Record<string, unknown>) => log('warn',  prefix, message, data),
  error: (prefix: string, message: string, data?: Record<string, unknown>) => log('error', prefix, message, data),
}
