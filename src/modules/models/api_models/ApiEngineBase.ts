/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Logger } from "../../components/common_components/logger";
import { IApiJobCreateResult, IApiEngineInitParameters, ICsvChunk } from "./helper_interfaces";
import { ApiInfo, IApiEngine } from ".";
import { Common } from "../../components/common_components/common";
import { CsvChunks, ScriptObject } from "..";
import { IOrgConnectionData, IFieldMapping, IFieldMappingResult } from "../common_models/helper_interfaces";
import { OPERATION } from "../../../addons/package/base/enumerations";
import { CONSTANTS } from "../../components/common_components/statics";






/**
 * Base class for all ApiProcess inherited classes
 *
 * @export
 * @class ApiProcessBase
 */
export default class ApiEngineBase implements IApiEngine, IFieldMapping {

    concurrencyMode: string;
    pollingIntervalMs: number
    bulkApiV1BatchSize: number;
    allOrNone: boolean;
    operation: OPERATION;
    updateRecordId: boolean;
    sObjectName: string;
    oldSObjectName: string;
    targetCSVFullFilename: string;
    createTargetCSVFiles: boolean;
    logger: Logger;
    simulationMode: boolean;

    connectionData: IOrgConnectionData;

    apiJobCreateResult: IApiJobCreateResult;

    numberJobRecordsSucceeded: number = 0;
    numberJobRecordsFailed: number = 0;

    get instanceUrl() {
        return this.connectionData.instanceUrl;
    }

    get accessToken() {
        return this.connectionData.accessToken;
    }

    get version() {
        return this.connectionData.apiVersion;
    }

    get strOperation(): string {
        return ScriptObject.getStrOperation(this.operation);
    }

    constructor(init: IApiEngineInitParameters) {
        this.logger = init.logger;
        this.connectionData = init.connectionData;
        this.sObjectName = init.sObjectName;
        this.operation = init.operation;
        this.pollingIntervalMs = init.pollingIntervalMs;
        this.concurrencyMode = init.concurrencyMode;
        this.updateRecordId = init.updateRecordId;
        this.bulkApiV1BatchSize = init.bulkApiV1BatchSize;
        this.allOrNone = init.allOrNone;
        this.createTargetCSVFiles = init.createTargetCSVFiles;
        this.targetCSVFullFilename = init.targetCSVFullFilename;
        this.simulationMode = init.simulationMode;
        if (init.targetFieldMapping) {
            Object.assign(this, init.targetFieldMapping);
        }
    }

    sourceQueryToTarget = (query: string, sourceObjectName: string) => <IFieldMappingResult>{ query, targetSObjectName: sourceObjectName };
    sourceRecordsToTarget = (records: any[], sourceObjectName: string) => <IFieldMappingResult>{ records, targetSObjectName: sourceObjectName };
    targetRecordsToSource = (records: any[], sourceObjectName: string) => <IFieldMappingResult>{ records, targetSObjectName: sourceObjectName };
    transformQuery: (query: string, sourceObjectName: string) => IFieldMappingResult;

    // ----------------------- Interface IApiProcess ----------------------------------
    getEngineName(): string {
        return "REST API";
    }

    async executeCRUD(allRecords: Array<any>, progressCallback: (progress: ApiInfo) => void): Promise<Array<any>> {

        // Map source records
        this.oldSObjectName = this.sObjectName;
        let mappedRecords = this.sourceRecordsToTarget(allRecords, this.sObjectName);
        this.sObjectName = mappedRecords.targetSObjectName;
        allRecords = mappedRecords.records;

        // Create CRUD job
        if (!this.simulationMode) {
            await this.createCRUDApiJobAsync(allRecords);
        } else {
            await this.createCRUDSimulationJobAsync(allRecords);
        }

        // Execute CRUD job
        let resultRecords = await this.processCRUDApiJobAsync(progressCallback);

        // Map target records
        this.sObjectName = this.oldSObjectName;
        resultRecords = this.targetRecordsToSource(resultRecords, this.sObjectName).records;

        // Return
        return resultRecords;
    }

    async createCRUDApiJobAsync(allRecords: Array<any>): Promise<IApiJobCreateResult> {
        return null;
    }

    async createCRUDSimulationJobAsync(allRecords: Array<any>): Promise<IApiJobCreateResult> {
        let chunks = new CsvChunks().fromArray(this.getSourceRecordsArray(allRecords));
        this.apiJobCreateResult = {
            chunks,
            apiInfo: new ApiInfo({
                jobState: "Undefined",
                strOperation: this.strOperation,
                sObjectName: this.sObjectName,
                jobId: "SIMULATION",
                batchId: "SIMULATION"
            }),
            allRecords
        };
        return this.apiJobCreateResult;
    }

    async processCRUDApiJobAsync(progressCallback: (progress: ApiInfo) => void): Promise<Array<any>> {
        let allResultRecords = new Array<any>();
        for (let index = 0; index < this.apiJobCreateResult.chunks.chunks.length; index++) {
            const csvCunk = this.apiJobCreateResult.chunks.chunks[index];
            let resultRecords = new Array<any>();
            if (!this.simulationMode) {
                resultRecords = await this.processCRUDApiBatchAsync(csvCunk, progressCallback);
            } else {
                resultRecords = await this.processCRUDSimulationBatchAsync(csvCunk, progressCallback);
            }
            if (!resultRecords) {
                // ERROR RESULT
                await this.writeToTargetCSVFileAsync(new Array<any>());
                return null;
            } else {
                allResultRecords = allResultRecords.concat(resultRecords);
            }
        }
        await this.writeToTargetCSVFileAsync(allResultRecords);
        return allResultRecords;
    }

    async processCRUDApiBatchAsync(csvChunk: ICsvChunk, progressCallback: (progress: ApiInfo) => void): Promise<Array<any>> {
        return null;
    }

    async processCRUDSimulationBatchAsync(csvChunk: ICsvChunk, progressCallback: (progress: ApiInfo) => void): Promise<Array<any>> {

        // Progress message: operation started ---------
        if (progressCallback) {
            progressCallback(new ApiInfo({
                jobState: "OperationStarted"
            }));
        }

        // Simulation -----------------------------------
        if (this.operation == OPERATION.Insert && this.updateRecordId) {
            csvChunk.records.forEach(record => {
                record["Id"] = Common.makeId(18);
            });
        }


        // Progress message: operation finished ---------
        if (progressCallback) {
            progressCallback(new ApiInfo({
                jobState: "OperationFinished"
            }));
        }

        // Create result records
        return this.getResultRecordsArray(csvChunk.records);

    }

    getStrOperation(): string {
        return this.strOperation;
    }
    // ----------------------- ---------------- -------------------------------------------    


    // ----------------------- Protected members ------------------------------------------- 
    /**
     * Writes target records to csv file during CRUD api operation
     *
     * @param {Array<any>} records
     * @returns {Promise<void>}
     * @memberof ApiEngineBase
     */
    protected async writeToTargetCSVFileAsync(records: Array<any>): Promise<void> {
        if (this.createTargetCSVFiles) {
            await Common.writeCsvFileAsync(this.targetCSVFullFilename, records, true);
        }
    }

    protected getSourceRecordsArray(records: Array<any>): Array<any> {
        if (this.operation == OPERATION.Delete && !this.simulationMode) {
            return records.map(x => x["Id"]);
        } else {
            return records;
        }
    }

    protected getResultRecordsArray(records: Array<any>): Array<any> {
        if (this.operation == OPERATION.Delete) {
            return records.map(record => {
                if (!this.simulationMode) {
                    return {
                        Id: record
                    };
                } else {
                    delete record[CONSTANTS.__ID_FIELD_NAME];
                    return record;
                }
            });
        } else {
            return records;
        }
    }

}