# Authena Query action

Execute a query against Athena on build. Optionally track query execution
state with DynamoDB.

## Inputs

## `sql-input`

**conditionally required** 

Raw SQL query. If not set, `sql-file` must be.

## `sql-file`

**conditionally required**

Path to SQL file with single SQL query. If not set, 
`sql-input` must be.

## `output-location`

**conditionally required** 

S3 path to store query results. If not set `workgroup` below must
be set, and configured with an output path. This can also be used in conjunction with
`workgroup` to override the default output.

## `workgroup`

**conditionally required** 

Workgroup to use to execute the query. If not set, `output-location`
above must be set.

## `database`

**optional** 

Database to run query against.

## `ddb-id`

**conditionally required** 

Unique ID for SQL statement for tracking, must be 
set if using `ddb-table` tracking below.

## `ddb-table`

**optional** 

DynamoDB table name to track state.

_If this is set, then the query will only be executed when the query
hash changes. The hash is based on `{{query-string}}`. If `wait = false`
and the query fails, this will still be updated. If you want to only update this on
a successful query, set `wait = true`. If this is not set, then the query will be 
executed with each run.

## `wait`

**optional** 

Wait for the query to finish before continuing. This would allow
you to utilize the query results in a successive build step. Must be set to
either `true` or `false`. _If this is set to true, and the query execute state 
is *FAILED* or *CANCELLED*, then the script will exit with an error._ If using 
DynamoDB to hold state, it will not be updated on failure.

## Outputs

## `query-execution-id`

The ID of the query execution, such as `d48bedd2-ddbc-4858-a623-dad454866b5c`.

## Example usage

### Execute an SQL statement on change only.

```yaml
uses: cebollia/athena-query-action@v1.0
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_REGION: us-east-1
with:
  sql-input: 'CREATE DATABASE mydatabase'
  ddb-id: 'create-mydatabase'
  ddb-table: 'github-athena-query-tracking'
  wait: 'false'
```

### Execute a query on every run.

```yaml
uses: cebollia/athena-query-action@v1.0
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_REGION: us-east-1
with:
  sql-input: 'SELECT 1+1'
```

### Execute an SQL file on change only.

```yaml
uses: cebollia/athena-query-action@v1.0
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_REGION: us-east-1
with:
  database: 'mydatabase'
  sql-file: 'path/to/query.sql'
  ddb-id: 'my-query-1'
  ddb-table: 'github-athena-query-tracking'
  wait: 'true'
```

## Permissions

The following IAM permissions are necessary depending on the flags utilized. 

| Input | Permissions |
| --- | --- |
| Base Permission         | `athena:StartQueryExecution`, `s3:putObject`
| `ddb-id`,`ddb-table`    | `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:CreateTable`
| `wait`                  | `athena:GetQueryExecution`

**You can omit dynamodb:CreateTable permissions by manually creating a table with
AttributeName: `id` with KeyType `HASH`.**