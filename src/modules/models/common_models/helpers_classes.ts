/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { MigrationJobTask, SFieldDescribe, ScriptObject, ScriptOrg } from "..";
import * as path from 'path';
import * as fs from 'fs';
import { OPERATION, CONSTANTS, DATA_MEDIA_TYPE } from "../../components/common_components/statics";
import { RESOURCES } from "../../components/common_components/logger";
import { Common } from "../../components/common_components/common";
import { IMissingParentLookupRecordCsvRow } from "./helper_interfaces";
import { ICsvChunk } from "../api_models";


// ----------------------- Interfaces -------------------------------//


// ----------------------- Classes -------------------------------//
export class TaskData {

    task: MigrationJobTask;
    sourceToTargetRecordMap: Map<any, any> = new Map<any, any>();

    constructor(task: MigrationJobTask) {
        this.task = task;
    }

    get fieldsToUpdateMap(): Map<string, SFieldDescribe> {
        return this.task.scriptObject.fieldsToUpdateMap;
    }

    get fieldsInQueryMap(): Map<string, SFieldDescribe> {
        return this.task.scriptObject.fieldsInQueryMap;
    }

    get sFieldsInQuery(): SFieldDescribe[] {
        return [...this.fieldsInQueryMap.values()];
    }

    get fieldsToUpdate(): string[] {
        return this.task.scriptObject.fieldsToUpdate;
    }

    get sFieldsToUpdate(): SFieldDescribe[] {
        return [...this.fieldsToUpdateMap.values()];
    }

    get fieldsInQuery(): string[] {
        return this.task.scriptObject.fieldsInQuery;
    }

    get csvFilename(): string {
        return this.task.getCSVFilename(this.task.script.basePath);
    }

    get sourceCsvFilename(): string {
        let filepath = path.join(this.task.script.basePath, CONSTANTS.CSV_SOURCE_SUB_DIRECTORY);
        if (!fs.existsSync(filepath)) {
            fs.mkdirSync(filepath);
        }
        return this.task.getCSVFilename(filepath, CONSTANTS.CSV_SOURCE_FILE_SUFFIX);
    }

    getTargetCSVFilename(operation: OPERATION, fileNameSuffix?: string): string {
        let filepath = path.join(this.task.script.basePath, CONSTANTS.CSV_TARGET_SUB_DIRECTORY);
        if (!fs.existsSync(filepath)) {
            fs.mkdirSync(filepath);
        }
        return this.task.getCSVFilename(filepath, `_${ScriptObject.getStrOperation(operation).toLowerCase()}${CONSTANTS.CSV_TARGET_FILE_SUFFIX}${fileNameSuffix || ""}`);
    }

    get resourceString_csvFile(): string {
        return this.task.logger.getResourceString(RESOURCES.csvFile);
    }

    get resourceString_org(): string {
        return this.task.logger.getResourceString(RESOURCES.org);
    }

    getResourceString_Step(mode: "forwards" | "backwards" | "target"): string {
        return mode == "forwards" ? this.task.logger.getResourceString(RESOURCES.Step1)
            : this.task.logger.getResourceString(RESOURCES.Step2);
    }

    get prevTasks(): MigrationJobTask[] {
        return this.task.job.tasks.filter(task => this.task.job.tasks.indexOf(task) < this.task.job.tasks.indexOf(this.task));
    }

    get nextTasks(): MigrationJobTask[] {
        return this.task.job.tasks.filter(task => this.task.job.tasks.indexOf(task) > this.task.job.tasks.indexOf(this.task));
    }

    get isPersonAccountEnabled(): boolean {
        return this.task.script.isPersonAccountEnabled;
    }

    get isPersonAccountOrContact(): boolean {
        return this.task.script.isPersonAccountEnabled
            && (this.task.sObjectName == "Account" || this.task.sObjectName == "Contact");
    }

}

export class TaskOrgData {

    task: MigrationJobTask;
    isSource: boolean;

    extIdRecordsMap: Map<string, string> = new Map<string, string>();
    idRecordsMap: Map<string, any> = new Map<string, any>();

    constructor(task: MigrationJobTask, isSource: boolean) {
        this.task = task;
        this.isSource = isSource;
    }

    get org(): ScriptOrg {
        return this.isSource ? this.task.script.sourceOrg : this.task.script.targetOrg;
    }

    get useBulkQueryApi(): boolean {
        return this.isSource ? this.task.sourceTotalRecorsCount > CONSTANTS.QUERY_BULK_API_THRESHOLD :
            this.task.targetTotalRecorsCount > CONSTANTS.QUERY_BULK_API_THRESHOLD;
    }

    get fieldsMap(): Map<string, SFieldDescribe> {
        return this.isSource ? this.task.scriptObject.sourceSObjectDescribe.fieldsMap :
            this.task.scriptObject.targetSObjectDescribe.fieldsMap;
    }

    get resourceString_Source_Target(): string {
        return this.isSource ? this.task.logger.getResourceString(RESOURCES.source) :
            this.task.logger.getResourceString(RESOURCES.target);
    }

    get allRecords(): boolean {
        return this.isSource ? this.task.scriptObject.processAllSource : this.task.scriptObject.processAllTarget;
    }

    get media(): DATA_MEDIA_TYPE {
        return this.org.media;
    }

    get records(): Array<any> {
        return [...this.idRecordsMap.values()];
    }
}

export class ProcessedData {

    processPersonAccounts: boolean = false;

    clonedToSourceMap: Map<any, any> = new Map<any, any>();

    fields: Array<SFieldDescribe>;

    recordsToUpdate: Array<any> = new Array<any>();
    recordsToInsert: Array<any> = new Array<any>();

    missingParentLookups: IMissingParentLookupRecordCsvRow[] = new Array<IMissingParentLookupRecordCsvRow>();

    get lookupIdFields(): Array<SFieldDescribe> {
        return this.fields.filter(field => field.isSimpleReference);
    }

    get fieldNames(): Array<string> {
        return this.fields.map(field => field.nameId);
    }
}

export class CachedCSVContent {

    constructor() {
        this.clear();
    }

    csvDataCacheMap: Map<string, Map<string, any>>;
    updatedFilenames: Set<string>;
    idCounter: number;


    /**
     * Generates next Id string in format I[DXXXXXXXXXXXXXXXX]
     * where XXXX... - is the next autonumber
     *
     * @readonly
     * @type {string}
     * @memberof CachedCSVContent
     */
    get nextId(): string {
        return "ID" + Common.addLeadnigZeros(this.idCounter++, 16);
    }


    /**
     * Clear all data
     *
     * @memberof CachedCSVContent
     */
    clear() {
        this.csvDataCacheMap = new Map<string, Map<string, any>>();
        this.updatedFilenames = new Set<string>();
        this.idCounter = 1;
    }
}

export class CsvChunks {
    
    constructor(init?: Partial<CsvChunks>) {
        Object.assign(this, init);
    }

    chunks: Array<ICsvChunk> = [];
    header: Array<string> = new Array<string>();

    fromArrayChunks(arrayChunks: Array<Array<any>>): CsvChunks {
        if (arrayChunks.length == 0) return;
        this.chunks = [].concat(arrayChunks.map(records => <ICsvChunk>{
            csvString: "",
            records
        }));
        this.header = Object.keys(arrayChunks[0][0]);
        return this;
    }

    fromArray(array: Array<any>): CsvChunks {
        return this.fromArrayChunks([array]);
    }
}



