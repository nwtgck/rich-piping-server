import * as yaml from "js-yaml";

export function customYamlLoad(str: string) {
  return yaml.load(str, { schema: customYamlSchema });
}

const concatYamlType = new yaml.Type('!concat', {
  kind: 'sequence',
  resolve(data) {
    return Array.isArray(data);
  },
  construct(data) {
    return data.join("");
  },
});

const envYamlType = new yaml.Type('!env', {
  kind: 'scalar',
  resolve(data) {
    return typeof data === "string";
  },
  construct(data) {
    return process.env[data];
  },
});

const jsYamlType = new yaml.Type('!unrecommended_js', {
  kind: 'scalar',
  resolve(data) {
    return typeof data === "string";
  },
  construct(data) {
    return new Function("require", data)(require);
  },
});

const customYamlSchema = yaml.DEFAULT_SCHEMA.extend([
  concatYamlType,
  envYamlType,
  jsYamlType,
]);
