import { parse } from "@babel/parser";
import { isNode, type Node } from "@babel/types";

function* nodesOf(text: string): Iterable<Node> {
  yield* walk(parse(text, { sourceType: "module", plugins: ["typescript"] }).program);
}

function* walk(value: unknown): Iterable<Node> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
  } else if (isNode(value)) {
    yield value;
    for (const child of Object.values(value)) yield* walk(child);
  }
}

export function importsOf(text: string): readonly string[] {
  const paths: string[] = [];
  for (const node of nodesOf(text)) {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      paths.push(node.source.value);
    } else if (node.type === "TSImportType") {
      paths.push(node.argument.value);
    } else if (
      node.type === "TSImportEqualsDeclaration" &&
      node.moduleReference.type === "TSExternalModuleReference"
    ) {
      paths.push(node.moduleReference.expression.value);
    } else if (
      node.type === "CallExpression" &&
      (node.callee.type === "Import" || (node.callee.type === "Identifier" && node.callee.name === "require"))
    ) {
      const [first] = node.arguments;
      if (first?.type === "StringLiteral") paths.push(first.value);
      if (first?.type === "TemplateLiteral" && first.expressions.length === 0) {
        const [quasi] = first.quasis;
        if (quasi?.value.cooked != null) paths.push(quasi.value.cooked);
      }
    }
  }
  return [...new Set(paths)];
}

const ENV_HOLDERS = new Set(["process", "Bun"]);

const PROCESS_MODULES = new Set(["process", "node:process"]);

function namesEnv(key: Node): boolean {
  return (
    (key.type === "Identifier" && key.name === "env") || (key.type === "StringLiteral" && key.value === "env")
  );
}

function holdsEnv(node: Node): boolean {
  return (
    (node.type === "Identifier" && ENV_HOLDERS.has(node.name)) ||
    (node.type === "MetaProperty" && node.meta.name === "import")
  );
}

function isEnvRead(node: Node): boolean {
  return (
    ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
      holdsEnv(node.object) &&
      namesEnv(node.property)) ||
    (node.type === "VariableDeclarator" &&
      node.init != null &&
      holdsEnv(node.init) &&
      node.id.type === "ObjectPattern" &&
      node.id.properties.some((property) => property.type === "ObjectProperty" && namesEnv(property.key))) ||
    (node.type === "ImportDeclaration" &&
      PROCESS_MODULES.has(node.source.value) &&
      node.specifiers.some(
        (specifier) => specifier.type === "ImportSpecifier" && namesEnv(specifier.imported),
      ))
  );
}

export function readsEnv(text: string): boolean {
  return [...nodesOf(text)].some(isEnvRead);
}
