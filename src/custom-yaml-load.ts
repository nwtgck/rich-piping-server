import * as yaml from "js-yaml";

export function customYamlLoad({extraEnv, yamlString}: {extraEnv: { [name: string]: string }, yamlString: string}) {
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
      // if env[data] is undefined, the config validation will occur an error.
      const env = {
        ...process.env,
        // override
        ...extraEnv,
      }
      return env[data];
    },
  });

  const jsonDecodeYamlType = new yaml.Type('!json_decode', {
    kind: 'scalar',
    resolve(data) {
      return typeof data === "string";
    },
    construct(data) {
      return JSON.parse(data);
    },
  });

  const unrecommendedJsYamlType = new yaml.Type('!unrecommended_js', {
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
    jsonDecodeYamlType,
    unrecommendedJsYamlType,
  ]);

  return yaml.load(yamlString, { schema: customYamlSchema });
}
