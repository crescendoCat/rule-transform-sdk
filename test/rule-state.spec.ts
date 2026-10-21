import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { getRuleState, putRuleState } from "../src/index";
import type { RuleState } from "../src/index";

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" }));

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
});

describe("getRuleState", () => {
  it("reads the state item", async () => {
    ddbMock.on(GetCommand, { Key: { ruleId: "r", metadata: "state" } }).resolves({
      Item: { ruleId: "r", metadata: "state", version: 4, triggered: true, lastTriggeredAt: "2026-10-01T00:00:00.000Z" }
    });
    expect(await getRuleState(client, "r")).toEqual({ lastTriggeredAt: "2026-10-01T00:00:00.000Z", triggered: true, recoveredAt: null, version: 4 });
    expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject({ TableName: "SensorRule", ConsistentRead: true });
  });

  it("starts from the legacy lastTrigger item when there is no state yet", async () => {
    ddbMock.on(GetCommand, { Key: { ruleId: "r", metadata: "lastTrigger" } }).resolves({
      Item: { ruleId: "r", metadata: "lastTrigger", value: "2022-05-09T15:48:29.052Z" }
    });
    expect(await getRuleState(client, "r", { tableName: "SensorRule-test" })).toEqual({
      lastTriggeredAt: "2022-05-09T15:48:29.052Z",
      triggered: false,
      recoveredAt: null,
      version: 0
    });
    expect(ddbMock.commandCalls(GetCommand).map((call) => call.args[0].input.TableName)).toEqual(["SensorRule-test", "SensorRule-test"]);
  });

  it("returns the initial state when nothing is stored", async () => {
    expect(await getRuleState(client, "r")).toEqual({ lastTriggeredAt: null, triggered: false, recoveredAt: null, version: 0 });
  });
});

describe("putRuleState", () => {
  const triggered: RuleState = { lastTriggeredAt: "2026-10-21T03:00:00.000Z", triggered: true, recoveredAt: null, version: 0 };

  it("creates the first state only if no state item exists", async () => {
    expect(await putRuleState(client, "r", triggered)).toEqual({ ok: true, version: 1 });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: "SensorRule",
      Item: { ruleId: "r", metadata: "state", schemaVersion: 2, version: 1, triggered: true, lastTriggeredAt: "2026-10-21T03:00:00.000Z" },
      ConditionExpression: "attribute_not_exists(ruleId)"
    });
  });

  it("replaces the state only if it still has the version that was read", async () => {
    const recovered: RuleState = { ...triggered, triggered: false, recoveredAt: "2026-10-21T04:00:00.000Z", version: 3 };
    expect(await putRuleState(client, "r", recovered)).toEqual({ ok: true, version: 4 });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      Item: { version: 4, triggered: false, recoveredAt: "2026-10-21T04:00:00.000Z" },
      ConditionExpression: "#version = :expected",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: { ":expected": 3 }
    });
  });

  it("reports a version conflict instead of overwriting", async () => {
    ddbMock.on(PutCommand).rejects(new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }));
    expect(await putRuleState(client, "r", { ...triggered, version: 2 })).toEqual({
      ok: false,
      conflict: true,
      errors: ["Rule State of r changed after version 2 was read"]
    });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("rejects an invalid state without writing", async () => {
    const invalid = { lastTriggeredAt: "yesterday", triggered: "yes", recoveredAt: null, version: -1 } as unknown as RuleState;
    expect(await putRuleState(client, "r", invalid)).toEqual({
      ok: false,
      conflict: false,
      errors: [
        "RuleState.lastTriggeredAt must be an ISO 8601 time or null",
        "RuleState.triggered must be a boolean",
        "RuleState.version must be an integer >= 0"
      ]
    });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("lets other DynamoDB errors through", async () => {
    ddbMock.on(PutCommand).rejects(new Error("ProvisionedThroughputExceededException"));
    await expect(putRuleState(client, "r", triggered)).rejects.toThrow("ProvisionedThroughputExceededException");
  });
});
