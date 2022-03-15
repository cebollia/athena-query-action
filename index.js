const fs        = require('fs');
const crypto    = require('crypto');
const core      = require('@actions/core');
const github    = require('@actions/github');
const athena    = require("@aws-sdk/client-athena");
const dynamodb  = require("@aws-sdk/client-dynamodb");

// Setup AWS Clients
const ddb = new dynamodb.DynamoDBClient();
const ath = new athena.AthenaClient();

// Application Seeds
let useddb = false;

(async function () {
  
  try {

    // Take inputs
    const i = {
      sql_input:        core.getInput("sql-input"),
      sql_file:         core.getInput("sql-file"),
      output_location:  core.getInput("output-location"),
      workgroup:        core.getInput("workgroup"),
      database:         core.getInput("database"),
      ddb_id:           core.getInput("ddb-id"),
      ddb_table:        core.getInput("ddb-table"),
      wait:             core.getInput("wait")
    };

    // Validate we either have a string or file based input.
    if(!i.sql_input && !i.sql_file) {
      throw new Error("Either sql-input or sql-file must be set.");
    }

    // Validate we don't have double-inputs.
    if(i.sql_input && i.sql_file) {
      throw new Error("Accepts input for either sql-input or sql-file, but not both.");
    }

    // Validate we have a workgroup and/or output location set
    if(!i.workgroup && !i.output_location) {
      throw new Error("Either output-location, workgroup, or both must be set.");
    }

    let query;

    // Set SQL string
    if(i.sql_input) {
    // Set from `sql-input`.
    
      query = i.sql_input;
      core.info(`Query loaded from input.`)

    } else {
    // Set from `sql-file`.

      // Validate file exists.
      if(!fs.existsSync(i.sql_file)) {
        throw new Error(`Unable to locate ${i.sql_file}`);
      }

      // Read file
      query = fs.readFileSync(i.sql_file, {
        encoding: 'utf8',
        flag: 'r'
      });

      core.info(`Query loaded from file ${i.sql_file}.`)

    }

    // One last validation on query length.
    if(query.length < 1) {
      throw new Error("Empty query.");
    }

    // If both ddb_id and ddb_table are set correctly.
    if((i.ddb_id && !i.ddb_table) || (!i.ddb_id && i.ddb_table)) {
      throw new Error("If using state tracking, both ddb-id and ddb-table must be set.")
    }

    // Check if ddb-table is set, if so we need to validate it 
    // exists, and if it does not exist let's create it.
    if(i.ddb_id && i.ddb_table) {

      // Validate table exists
      let cmd, resp;
      useddb = true;

      try {

        cmd = new dynamodb.DescribeTableCommand({ TableName: i.ddb_table });
        resp = await ddb.send(cmd);
        core.info(`DynamoDB table ${i.ddb_table} found.`);

      } catch(e) {

        if(e.name == "ResourceNotFoundException") {
        // Table does not exist, Create it.

          core.info(`DunamoDB table ${i.ddb_table} not found, attempting to create.`)

          try {

            cmd = new dynamodb.CreateTableCommand({
              TableName: i.ddb_table,
              AttributeDefinitions: [
                {
                  AttributeName: "id",
                  AttributeType: "S"
                }
              ],
              BillingMode: "PAY_PER_REQUEST",
              KeySchema: [
                {
                  AttributeName: "id",
                  KeyType: "HASH"
                }
              ],
              Tags: [
                { 
                  Key: "Product", 
                  Value: "athena-query-action" 
                },
                { 
                  Key: "Description", 
                  Value: "Track Athena query state during Github Actions."
                },
                {
                  Key: "URL",
                  Value: "https://github.com/cebollia/athena-query-action"
                }
              ]
            });
            
            resp = await ddb.send(cmd);
            core.info(`DynamoDB table ${i.ddb_table} created.`)

            // Give AWS time to create table, this logic should be updated
            // to actually check table status.
            var waitTill = new Date(new Date().getTime() + 5 * 1000);
            while(waitTill > new Date()){}

          } catch(e) {

            throw new Error(`Error creating DynamoDB table: ${e.name}`);

          }

        } else {
        // Error accessing table, most likely permissions issue.
          throw new Error(`Error accessing DynamoDB table: ${e.name}`);
        }

      }

    }

    // Check if the query state already exists
    if(useddb) {

      // Pull key
      cmd = new dynamodb.GetItemCommand({
        TableName: i.ddb_table,
        Key: { id: { S: i.ddb_id }}
      });
      resp = await ddb.send(cmd);
      
      // Item returned, check to see if SQL hash matches. If so, we are done here.
      if(resp.Item != null && resp.Item.hash.S == crypto.createHash('md5').update(query).digest('hex')) {
        core.info("Query has not changed, nothing to do.")
        return;
      }

    }

    // Run Athena Query
    try {

      core.info(`Running Query: ${query}`);

      let params = {
        QueryString: query
      };

      // Set Workgroup
      if(i.workgroup) 
        params["WorkGroup"] = i.workgroup;

      // Set Output Location
      if(i.output_location)
        params["ResultConfiguration"] = { OutputLocation: i.output_location};

      cmd = new athena.StartQueryExecutionCommand(params);
      resp = await ath.send(cmd);

      core.info(`Query ID: ${resp.QueryExecutionId}`);
      core.setOutput("query-id", resp.QueryExecutionId);

      // Check for query status
      cmd = new athena.GetQueryExecutionCommand({ QueryExecutionId: resp.QueryExecutionId });
      do {
        
        // Don't wait for query to finish
        if(i.wait !== "true")
          break;
        
        // Check query status
        resp = await ath.send(cmd);
        if(["FAILED", "CANCELLED"].includes(resp.QueryExecution.Status))
          throw new Error(`Athena query error: ${resp.QueryExecution.Status}`);

        // Success
        if(resp.QueryExecution.Status.State == "SUCCEEDED")
          break;
        
        // Sleep for 5 seconds to update status
        // https://stackoverflow.com/a/37575602
        core.info("Waiting for query execution to finish, sleeping for 5 seconds.")
        let waitTill = new Date(new Date().getTime() + 5 * 1000);
        while(waitTill > new Date()){}

      } while(true);

    } catch(e) {

      if("name" in e) {
        throw new Error(`Error running Athena query: ${e.name}`);
      }

      throw e;

    }

    // Update the query hash in DDB
    if(useddb) {

      cmd = new dynamodb.PutItemCommand({
        TableName: i.ddb_table,
        Item: {
          id: { S: i.ddb_id },
          hash: { S: crypto.createHash('md5').update(query).digest('hex') },
          timestamp: { N: String(Math.floor(Date.now()/1000)) }
        }
      });
      resp = await ddb.send(cmd);

      core.info("DynamoDB updated with latest query hash.")

    }

  } catch (e) {

    core.setFailed(e.message);

  }

})();