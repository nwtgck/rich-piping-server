import {customYamlLoad} from "../custom-yaml-load";
import * as fs from "fs";
import {configV1Schema, migrateToConfigV1} from "../config/v1";
import {configWihtoutVersionSchema} from "../config/without-version";
import * as yaml from "js-yaml";

export function migrateConfigCommand(configPath: string) {
  const configYaml = customYamlLoad(fs.readFileSync(configPath, 'utf8'));
  if (configV1Schema.safeParse(configYaml).success) {
    console.log("The config is already a valid config v1");
    return;
  }
  const configParsed = configWihtoutVersionSchema.safeParse(configYaml);
  if(!configParsed.success) {
    const issueStack = configParsed.error.issues.slice();
    while (issueStack.length > 0) {
      const issue = issueStack.pop()!;
      if (issue.code === "invalid_union") {
        issueStack.push(...issue.unionErrors.flatMap(e => e.issues));
        continue;
      }
      process.stderr.write(`config error hint: ${JSON.stringify(issue)}\n`);
    }
    process.exit(1);
  }
  const configV1 = migrateToConfigV1(configParsed.data);
  console.log(yaml.dump(configV1));
}
