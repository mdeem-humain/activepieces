import type {
    EnginePluginApiVersion,
    EnginePluginFactory,
    PieceInvocationBeforeContext,
    PieceInvocationBeforeResult,
    PieceInvocationMiddleware,
} from '@activepieces/core-execution'

function createCompiledRules({
    rules,
}: {
    rules: RedactionRuleConfig[]
}): CompiledRule[] {
    return rules.map((rule) => ({
        name: rule.name,
        regexp: new RegExp(rule.pattern, normalizeFlags({ flags: rule.flags })),
    }))
}

function parseConfig({
    config,
}: {
    config: unknown
}): RedactionPluginConfig {
    if (config === undefined) {
        return {
            rules: [],
        }
    }
    if (!isRecord(config)) {
        throw new Error('Redact input strings plugin config must be an object')
    }

    return {
        pieceNames: parseOptionalStringArray({
            value: config.pieceNames,
            propertyName: 'pieceNames',
        }),
        rules: parseOptionalRules({ value: config.rules }),
    }
}

function parseOptionalStringArray({
    value,
    propertyName,
}: {
    value: unknown
    propertyName: string
}): string[] | undefined {
    if (value === undefined) {
        return undefined
    }
    if (!Array.isArray(value)) {
        throw new Error(`Redact input strings plugin config ${propertyName} must be an array of non-empty strings`)
    }

    const result: string[] = []
    for (const item of value) {
        if (typeof item !== 'string' || item.length === 0) {
            throw new Error(`Redact input strings plugin config ${propertyName} must be an array of non-empty strings`)
        }
        result.push(item)
    }
    return result
}

function parseOptionalRules({
    value,
}: {
    value: unknown
}): RedactionRuleConfig[] {
    if (value === undefined) {
        return []
    }
    if (!Array.isArray(value)) {
        throw new Error('Redact input strings plugin config rules must be an array')
    }
    return value.map((rule, index) => parseRule({ rule, index }))
}

function parseRule({
    rule,
    index,
}: {
    rule: unknown
    index: number
}): RedactionRuleConfig {
    if (!isRecord(rule)) {
        throw new Error(`Redact input strings plugin rule at index ${index} must be an object`)
    }
    const name = parseRequiredString({
        value: rule.name,
        propertyName: 'name',
        index,
    })
    const pattern = parseRequiredString({
        value: rule.pattern,
        propertyName: 'pattern',
        index,
    })
    const flags = parseOptionalString({
        value: rule.flags,
        propertyName: 'flags',
        index,
    })

    return {
        name,
        pattern,
        ...(flags === undefined ? {} : { flags }),
    }
}

function parseRequiredString({
    value,
    propertyName,
    index,
}: {
    value: unknown
    propertyName: string
    index: number
}): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Redact input strings plugin rule at index ${index} must define non-empty string ${propertyName}`)
    }
    return value
}

function parseOptionalString({
    value,
    propertyName,
    index,
}: {
    value: unknown
    propertyName: string
    index: number
}): string | undefined {
    if (value === undefined) {
        return undefined
    }
    if (typeof value !== 'string') {
        throw new Error(`Redact input strings plugin rule at index ${index} must define string ${propertyName}`)
    }
    return value
}

function normalizeFlags({
    flags,
}: {
    flags?: string
}): string {
    const configuredFlags = flags ?? ''
    const seenFlags = new Set<string>()

    for (const flag of configuredFlags) {
        if (!SUPPORTED_REGEXP_FLAGS.has(flag)) {
            throw new Error(`Redact input strings plugin rule uses unsupported regexp flag "${flag}"`)
        }
        if (seenFlags.has(flag)) {
            throw new Error(`Redact input strings plugin rule uses duplicate regexp flag "${flag}"`)
        }
        seenFlags.add(flag)
    }

    if (!seenFlags.has('g')) {
        seenFlags.add('g')
    }

    return Array.from(seenFlags).join('')
}

function buildMiddleware({
    rules,
    pieceNames,
}: {
    rules: CompiledRule[]
    pieceNames?: string[]
}): PieceInvocationMiddleware {
    return {
        name: 'redact-input-strings-middleware',
        ...(pieceNames === undefined ? {} : { match: { pieceName: pieceNames } }),
        before: (context) => redactBeforePieceInvocation({
            context,
            rules,
        }),
    }
}

function redactBeforePieceInvocation({
    context,
    rules,
}: {
    context: PieceInvocationBeforeContext
    rules: CompiledRule[]
}): PieceInvocationBeforeResult | undefined {
    if (!context.canReplaceInput || rules.length === 0 || !hasPropsValue(context.input)) {
        return undefined
    }

    const result = redactValue({
        value: context.input.propsValue,
        rules,
        depth: 0,
        visitedCount: 0,
    })

    if (result.redactionCount === 0) {
        return undefined
    }

    return {
        input: {
            ...context.input,
            propsValue: result.value,
        },
    }
}

function redactValue({
    value,
    rules,
    depth,
    visitedCount,
}: RedactValueParams): RedactValueResult {
    if (visitedCount >= MAX_VISITED_NODES) {
        throw new Error('Redact input strings plugin traversal visited too many nodes')
    }
    if (depth > MAX_TRAVERSAL_DEPTH) {
        throw new Error('Redact input strings plugin traversal exceeded maximum depth')
    }

    const nextVisitedCount = visitedCount + 1

    if (typeof value === 'string') {
        return redactString({
            value,
            rules,
            visitedCount: nextVisitedCount,
        })
    }

    if (Array.isArray(value)) {
        return redactArray({
            value,
            rules,
            depth,
            visitedCount: nextVisitedCount,
        })
    }

    if (isPlainObject(value)) {
        return redactPlainObject({
            value,
            rules,
            depth,
            visitedCount: nextVisitedCount,
        })
    }

    return {
        value,
        redactionCount: 0,
        visitedCount: nextVisitedCount,
    }
}

function redactString({
    value,
    rules,
    visitedCount,
}: {
    value: string
    rules: CompiledRule[]
    visitedCount: number
}): RedactValueResult {
    let redactedValue = value
    let redactionCount = 0

    for (const rule of rules) {
        rule.regexp.lastIndex = 0
        redactedValue = redactedValue.replace(rule.regexp, () => {
            redactionCount += 1
            return REDACTED_VALUE
        })
    }

    return {
        value: redactedValue,
        redactionCount,
        visitedCount,
    }
}

function redactArray({
    value,
    rules,
    depth,
    visitedCount,
}: {
    value: unknown[]
    rules: CompiledRule[]
    depth: number
    visitedCount: number
}): RedactValueResult {
    const nextArray: unknown[] = []
    let nextVisitedCount = visitedCount
    let redactionCount = 0
    let changed = false

    for (const item of value) {
        const itemResult = redactValue({
            value: item,
            rules,
            depth: depth + 1,
            visitedCount: nextVisitedCount,
        })
        nextArray.push(itemResult.value)
        nextVisitedCount = itemResult.visitedCount
        redactionCount += itemResult.redactionCount
        changed = changed || itemResult.value !== item
    }

    return {
        value: changed ? nextArray : value,
        redactionCount,
        visitedCount: nextVisitedCount,
    }
}

function redactPlainObject({
    value,
    rules,
    depth,
    visitedCount,
}: {
    value: Record<string, unknown>
    rules: CompiledRule[]
    depth: number
    visitedCount: number
}): RedactValueResult {
    const nextObject: Record<string, unknown> = {}
    let nextVisitedCount = visitedCount
    let redactionCount = 0
    let changed = false

    for (const [key, item] of Object.entries(value)) {
        const itemResult = redactValue({
            value: item,
            rules,
            depth: depth + 1,
            visitedCount: nextVisitedCount,
        })
        nextObject[key] = itemResult.value
        nextVisitedCount = itemResult.visitedCount
        redactionCount += itemResult.redactionCount
        changed = changed || itemResult.value !== item
    }

    return {
        value: changed ? nextObject : value,
        redactionCount,
        visitedCount: nextVisitedCount,
    }
}

function hasPropsValue(value: unknown): value is PieceInputWithPropsValue {
    return isRecord(value) && hasOwnProperty({
        record: value,
        propertyName: 'propsValue',
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) {
        return false
    }
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function hasOwnProperty({
    record,
    propertyName,
}: {
    record: Record<string, unknown>
    propertyName: string
}): boolean {
    return Object.prototype.hasOwnProperty.call(record, propertyName)
}

const enginePlugin: EnginePluginFactory = ({ config, logger }) => {
    const parsedConfig = parseConfig({ config })
    const rules = createCompiledRules({ rules: parsedConfig.rules })
    const ruleNames = rules.map((rule) => rule.name)

    logger.info({
        ruleCount: rules.length,
        ruleNames,
        pieceNameCount: parsedConfig.pieceNames?.length ?? 0,
    }, 'Loaded redact input strings engine plugin')

    return {
        name: 'redact-input-strings-example',
        version: '0.1.0',
        apiVersion: ENGINE_PLUGIN_API_VERSION,
        hookFailurePolicy: 'fail-invocation',
        pieceInvocationMiddleware: [
            buildMiddleware({
                rules,
                pieceNames: parsedConfig.pieceNames,
            }),
        ],
    }
}

const REDACTED_VALUE = 'REDACTED'
const MAX_TRAVERSAL_DEPTH = 20
const MAX_VISITED_NODES = 10000
const SUPPORTED_REGEXP_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y'])
const ENGINE_PLUGIN_API_VERSION = '2026-07-01' satisfies EnginePluginApiVersion

export { enginePlugin }

type RedactionPluginConfig = {
    pieceNames?: string[]
    rules: RedactionRuleConfig[]
}

type RedactionRuleConfig = {
    name: string
    pattern: string
    flags?: string
}

type CompiledRule = {
    name: string
    regexp: RegExp
}

type PieceInputWithPropsValue = Record<string, unknown> & {
    propsValue: unknown
}

type RedactValueParams = {
    value: unknown
    rules: CompiledRule[]
    depth: number
    visitedCount: number
}

type RedactValueResult = {
    value: unknown
    redactionCount: number
    visitedCount: number
}
