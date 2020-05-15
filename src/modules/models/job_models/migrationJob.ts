/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */


import { Common } from "../../components/common_components/common";
import { CONSTANTS, DATA_MEDIA_TYPE } from "../../components/common_components/statics";
import { Logger, RESOURCES } from "../../components/common_components/logger";
import { Script, ScriptObject, MigrationJobTask as Task, SuccessExit } from "..";
import * as path from 'path';
import * as fs from 'fs';
import MigrationJobTask, { ProcessedData } from "./migrationJobTask";



export default class MigrationJob {

    script: Script;
    tasks: Task[] = new Array<Task>();
    queryTasks: Task[] = new Array<Task>();
    csvValuesMapping: Map<string, Map<string, string>> = new Map<string, Map<string, string>>();
    csvIssues: Array<ICSVIssueCsvRow> = new Array<ICSVIssueCsvRow>();
    cachedCSVContent: CachedCSVContent = new CachedCSVContent();

    constructor(init: Partial<MigrationJob>) {
        if (init) {
            Object.assign(this, init);
        }
    }

    get logger(): Logger {
        return this.script.logger;
    }

    get objects(): ScriptObject[] {
        return this.script.objects;
    }




    // ----------------------- Public methods -------------------------------------------        
    /**
     * Setup this object
     *
     * @memberof MigrationJob
     */
    setup() {

        let self = this;

        this.script.job = this;
        let lowerIndexForAnyObjects = 0;
        let lowerIndexForReadonlyObjects = 0;

        // Create task chain in the optimized order
        // to put parent related objects before their children
        this.script.objects.forEach(objectToAdd => {

            // New task object to insert into the task chain
            let newTask: Task = new Task({
                scriptObject: objectToAdd,
                job: this
            });
            if (objectToAdd.allRecords
                || objectToAdd.isSpecialObject
                || objectToAdd.isObjectWithoutRelationships
            ) {
                objectToAdd.processAllSource = true;
                objectToAdd.processAllTarget = true;
            } else {
                objectToAdd.processAllSource = false;
                if (objectToAdd.hasComplexExternalId || objectToAdd.hasAutonumberExternalId) {
                    objectToAdd.processAllTarget = true;
                } else {
                    objectToAdd.processAllTarget = false;
                }
            }
            if (objectToAdd.name == CONSTANTS.RECORD_TYPE_SOBJECT_NAME) {
                // RecordType object is always at the beginning 
                //   of the task chain
                this.tasks.unshift(newTask);
                lowerIndexForAnyObjects++;
                lowerIndexForReadonlyObjects++;
            } else if (objectToAdd.isReadonlyObject) {
                // Readonly objects are always at the beginning 
                //   of the task chain 
                //   but after RecordType
                this.tasks.splice(lowerIndexForReadonlyObjects, 0, newTask);
                lowerIndexForAnyObjects++;
            } else if (this.tasks.length == 0) {
                // First object in the task chain
                this.tasks.push(newTask);
            } else {
                // The index where to insert the new object
                let indexToInsert: number = this.tasks.length;
                for (var existedTaskIndex = this.tasks.length - 1; existedTaskIndex >= lowerIndexForAnyObjects; existedTaskIndex--) {
                    var existedTask = this.tasks[existedTaskIndex];
                    // Check if the new object is parent lookup to the existed task
                    let isObjectToAdd_ParentLookup = existedTask.scriptObject.parentLookupObjects.some(x => x.name == objectToAdd.name);
                    // Check if the existed task is parent master-detail to the new object
                    //let isExistedTask_ParentMasterDetail = objectToAdd.parentMasterDetailObjects.some(x => x.name == existedTask.scriptObject.name) 
                    //                                      || existedTask.tempData.isMasterDetailTask; //TODO: Check this option

                    //let isExistedTask_ParentMasterDetail = objectToAdd.parentMasterDetailObjects.some(x => x.name == existedTask.scriptObject.name);
                    //if (isObjectToAdd_ParentLookup && !isExistedTask_ParentMasterDetail) {
                    if (isObjectToAdd_ParentLookup) {
                        // The new object is the parent lookup, but it is not a child master-detail 
                        //                  => it should be before BEFORE the existed task (replace existed task with it)
                        indexToInsert = existedTaskIndex;
                    }
                    /* // TODO: Check this option
                    else if (isExistedTask_ParentMasterDetail) {
                        existedTask.tempData.isMasterDetailTask = true;
                    }
                    */
                    // The existed task is the parent lookup or the parent master-detail 
                    //                      => it should be AFTER the exited task (continue as is)
                }
                // Insert the new object 
                //   into the task chain
                //   at the calculated index
                this.tasks.splice(indexToInsert, 0, newTask);
            }
        });

        // Put master-detail lookups before
        let swapped = true;
        for (let iteration = 0; iteration < 10 || !swapped; iteration++) {
            swapped = ___putMasterDetailsBefore();
        }

        // Create query task order
        this.tasks.forEach(task => {
            if (task.sourceData.allRecords
                || task.scriptObject.isLimitedQuery) {
                this.queryTasks.push(task);
            }
        });
        this.tasks.forEach(task => {
            if (this.queryTasks.indexOf(task) < 0) {
                this.queryTasks.push(task);
            }
        });

        // Output execution orders
        this.logger.objectMinimal({
            [this.logger.getResourceString(RESOURCES.queryingOrder)]: this.queryTasks.map(x => x.sObjectName).join("; ")
        });
        this.logger.objectMinimal({
            [this.logger.getResourceString(RESOURCES.executionOrder)]: this.tasks.map(x => x.sObjectName).join("; ")
        });
        
        //throw new Error();


        // ------------------------------- Internal functions --------------------------------------- //
        function ___putMasterDetailsBefore() : boolean{
            let swapped = false;
            let tempTasks: Array<MigrationJobTask> = [].concat(self.tasks);
            for (let leftIndex = 0; leftIndex < tempTasks.length - 1; leftIndex++) {
                const leftTask = tempTasks[leftIndex];
                for (let rightIndex = leftIndex + 1; rightIndex < tempTasks.length; rightIndex++) {
                    const rightTask = tempTasks[rightIndex];
                    let rightIsParentMasterDetailOfLeft = leftTask.scriptObject.parentMasterDetailObjects.some(object => object.name == rightTask.sObjectName);
                    let leftTaskIndex = self.tasks.indexOf(leftTask);
                    let rightTaskIndex = self.tasks.indexOf(rightTask);
                    if (rightIsParentMasterDetailOfLeft){
                        // Swape places and put right before left
                        self.tasks.splice(rightTaskIndex, 1);
                        self.tasks.splice(leftTaskIndex, 0, rightTask);
                        swapped = true;
                    } 
                }
            }
            return swapped;
        }
    }

    /**
     * Validate and fix the CSV files if 
     * CSV files are set as the data source
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async validateCSVFiles(): Promise<void> {
        if (this.script.sourceOrg.media == DATA_MEDIA_TYPE.File) {

            await this._mergeUserGroupCSVfiles();
            await this._loadCSVValueMappingFileAsync();
            this._copyCSVFilesToSourceSubDir();

            if (!this.script.importCSVFilesAsIs) {

                // Validate and repair source csv files
                this.logger.infoMinimal(RESOURCES.validatingAndFixingSourceCSVFiles);

                await this._validateAndRepairSourceCSVFiles();

                this.logger.infoVerbose(RESOURCES.validationAndFixingsourceCSVFilesCompleted);

                if (this.script.validateCSVFilesOnly) {
                    // Succeeded exit
                    throw new SuccessExit();
                }

                // Free memory from the csv file data
                this.clearCachedCSVData();

            } else {
                this.logger.infoMinimal(RESOURCES.validatingSourceCSVFilesSkipped);
            }
        }
    }

    /**
    * Retireve the total record count for each task in the job
    *
    * @returns {Promise<void>}
    * @memberof MigrationJob
    */
    async getTotalRecordsCount(): Promise<void> {

        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.gettingRecordsCount);

        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            await task.getTotalRecordsCountAsync();
        }
    }

    /**
    * Delete old records of each task in the job
    *
    * @returns {Promise<void>}
    * @memberof MigrationJob
    */
    async deleteOldRecords(): Promise<void> {

        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.deletingOldData);

        let deleted = false;
        for (let index = this.tasks.length - 1; index >= 0; index--) {
            const task = this.tasks[index];
            deleted = await task.deleteOldTargetRecords() || deleted;
        }

        if (deleted) {
            this.logger.infoVerbose(RESOURCES.deletingOldDataCompleted);
        } else {
            this.logger.infoVerbose(RESOURCES.deletingOldDataSkipped);
        }
    }

    /**
     * Retrieve records for all tasks in the job
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async retrieveRecords(): Promise<void> {

        //::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        // STEP 1 SOURCE FORWARDS  :::::::::::::::::::::::::::::::::::::::::::::::::
        let retrieved: boolean = false;
        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.retrievingData, this.logger.getResourceString(RESOURCES.Step1));
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("forwards", false) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }
        this.logger.infoNormal(RESOURCES.retrievingDataCompleted, this.logger.getResourceString(RESOURCES.Step1));


        //:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        // STEP 2 SOURCE BACKWARDS ::::::::::::::::::::::::::::::::::::::::::::::::
        // PASS 1 --- 
        retrieved = false;
        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.retrievingData, this.logger.getResourceString(RESOURCES.Step2));

        this.logger.infoNormal(RESOURCES.Pass1);
        this.logger.infoNormal(RESOURCES.separator);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("backwards", false) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }

        // PASS 2 --- 
        retrieved = false;
        this.logger.infoNormal(RESOURCES.newLine);
        this.logger.infoNormal(RESOURCES.Pass2);
        this.logger.infoNormal(RESOURCES.separator);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("backwards", false) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }

        // PASS 3 --- SOURCE FORWARDS (REVERSE A)
        retrieved = false;
        this.logger.infoNormal(RESOURCES.newLine);
        this.logger.infoNormal(RESOURCES.Pass3);
        this.logger.infoNormal(RESOURCES.separator);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("forwards", true) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }

        // PASS 4 --- SOURCE FORWARDS (REVERSE B) 
        retrieved = false;
        this.logger.infoNormal(RESOURCES.newLine);
        this.logger.infoNormal(RESOURCES.Pass4);
        this.logger.infoNormal(RESOURCES.separator);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("forwards", true) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }


        //:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        // STEP 3 TARGET ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        retrieved = false;
        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.infoMinimal(RESOURCES.target);
        this.logger.infoMinimal(RESOURCES.separator);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            retrieved = await task.retrieveRecords("target", false) || retrieved;
        }
        if (!retrieved) {
            this.logger.infoNormal(RESOURCES.noRecords);
        }
        this.logger.infoNormal(RESOURCES.retrievingDataCompleted, this.logger.getResourceString(RESOURCES.Step2));


        //::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        // TOTAL FETCHED SUMMARY :::::::::::::::::::::::::::::::::::::::::::::::::::
        this.logger.infoNormal(RESOURCES.newLine);
        this.logger.headerNormal(RESOURCES.fetchingSummary);
        for (let index = 0; index < this.queryTasks.length; index++) {
            const task = this.queryTasks[index];
            this.logger.infoNormal(RESOURCES.queryingTotallyFetched,
                task.sObjectName,
                String(task.sourceData.extIdRecordsMap.size + "/" + task.targetData.extIdRecordsMap.size));
        }
    }

    async updateRecords(): Promise<void> {

        let self = this;

        //:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        // STEP 1 FORWARDS ::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.updatingTarget, this.logger.getResourceString(RESOURCES.Step1));

        let noAbortPrompt = false;
        let totalProcessedRecordsAmount = 0;

        let allMissingParentLookups: IMissingParentLookupRecordCsvRow[] = new Array<IMissingParentLookupRecordCsvRow>();

        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            let processedRecordsAmount = (await task.updateRecords("forwards", async (data: ProcessedData) => {
                allMissingParentLookups = allMissingParentLookups.concat(data.missingParentLookups);
                if (noAbortPrompt) {
                    ___warn(data, task.sObjectName);
                    return;
                }
                await ___promptToAbort(data, task.sObjectName);
                noAbortPrompt = true;
            }));
            if (processedRecordsAmount > 0) {
                this.logger.infoNormal(RESOURCES.updatingTargetObjectCompleted, task.sObjectName, String(processedRecordsAmount));
            }
            totalProcessedRecordsAmount += processedRecordsAmount;
        }
        if (totalProcessedRecordsAmount > 0)
            this.logger.infoNormal(RESOURCES.updatingTargetCompleted, this.logger.getResourceString(RESOURCES.Step1), String(totalProcessedRecordsAmount));
        else
            this.logger.infoNormal(RESOURCES.nothingUpdated);


        //:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::            
        // STEP 2 BACKWARDS :::::::::::::::::::::::::::::::::::::::::::::::::::::::
        this.logger.infoMinimal(RESOURCES.newLine);
        this.logger.headerMinimal(RESOURCES.updatingTarget, this.logger.getResourceString(RESOURCES.Step2));

        totalProcessedRecordsAmount = 0;

        if (this.script.targetOrg.media == DATA_MEDIA_TYPE.Org) {
            for (let index = 0; index < this.tasks.length; index++) {
                const task = this.tasks[index];
                let processedRecordsAmount = (await task.updateRecords("backwards", async (data: ProcessedData) => {
                    allMissingParentLookups = allMissingParentLookups.concat(data.missingParentLookups);
                    if (noAbortPrompt) {
                        ___warn(data, task.sObjectName);
                        return;
                    }
                    await ___promptToAbort(data, task.sObjectName);
                    noAbortPrompt = true;
                }));
                if (processedRecordsAmount > 0) {
                    this.logger.infoNormal(RESOURCES.updatingTargetObjectCompleted, task.sObjectName, String(processedRecordsAmount));
                }
                totalProcessedRecordsAmount += processedRecordsAmount;
            }
        }
        if (totalProcessedRecordsAmount > 0)
            this.logger.infoNormal(RESOURCES.updatingTargetCompleted, this.logger.getResourceString(RESOURCES.Step2), String(totalProcessedRecordsAmount));
        else
            this.logger.infoNormal(RESOURCES.nothingUpdated);

        this.logger.infoVerbose(RESOURCES.newLine);
        await self.saveCSVFileAsync(CONSTANTS.MISSING_PARENT_LOOKUP_RECORDS_ERRORS_FILENAME, allMissingParentLookups);


        // ---------------------- Internal functions -------------------------------------- //
        async function ___promptToAbort(data: ProcessedData, sObjectName: string): Promise<void> {
            await Common.abortWithPrompt(self.logger,
                RESOURCES.missingParentLookupsPrompt,
                self.script.promptOnMissingParentObjects,
                RESOURCES.continueTheJobPrompt,
                "",
                async () => {
                    await self.saveCSVFileAsync(CONSTANTS.MISSING_PARENT_LOOKUP_RECORDS_ERRORS_FILENAME, allMissingParentLookups);
                },
                sObjectName,
                String(data.missingParentLookups.length),
                CONSTANTS.MISSING_PARENT_LOOKUP_RECORDS_ERRORS_FILENAME);
        }

        function ___warn(data: ProcessedData, sObjectName: string) {
            self.logger.warn(RESOURCES.missingParentLookupsPrompt,
                sObjectName,
                String(data.missingParentLookups.length),
                CONSTANTS.MISSING_PARENT_LOOKUP_RECORDS_ERRORS_FILENAME);
        }

    }

    /**
     * Returns a task by the given sObject name
     *
     * @param {string} sObjectName The sobject name
     * @returns
     * @memberof MigrationJob
     */
    getTaskBySObjectName(sObjectName: string) {
        return this.tasks.filter(x => x.sObjectName == sObjectName)[0];
    }

    /**
     * Save csv file from the data of the input array
     *
     * @param {string} fileName It is just a filename (test.csv) not the full path
     * @param {Array<any>} data The data to write to csv file
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async saveCSVFileAsync(fileName: string, data: Array<any>): Promise<void> {
        let filePath = path.join(this.script.basePath, fileName);
        this.logger.infoVerbose(RESOURCES.writingToCSV, filePath);
        await Common.writeCsvFileAsync(filePath, data, true);
    }

    /**
     * Save all updated cached csv files
     *
     * @returns {Promise<any>}
     * @memberof MigrationJob
     */
    async saveCachedCsvDataFiles(): Promise<any> {
        let filePaths = [...this.cachedCSVContent.csvDataCacheMap.keys()];
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            if (this.cachedCSVContent.updatedFilenames.has(filePath)) {
                let csvData = this.cachedCSVContent.csvDataCacheMap.get(filePath);
                this.logger.infoVerbose(RESOURCES.writingToCSV, filePath);
                await Common.writeCsvFileAsync(filePath, [...csvData.values()], true);
            }
        }
    }

    /**
     * Clear cached csv data
     *
     * @memberof MigrationJob
     */
    clearCachedCSVData() {
        this.cachedCSVContent.clear();
    }

    /**
    * Remove target directory
    *
    * @memberof MigrationJob
    */
    deleteTargetCSVDirectory() {
        let filepath = path.join(this.script.basePath, CONSTANTS.CSV_TARGET_SUB_DIRECTORY);
        Common.deleteFolderRecursive(filepath);
    }

    // --------------------------- Private members -------------------------------------
    private async _loadCSVValueMappingFileAsync(): Promise<void> {
        let valueMappingFilePath = path.join(this.script.basePath, CONSTANTS.VALUE_MAPPING_CSV_FILENAME);
        let csvRows = await Common.readCsvFileAsync(valueMappingFilePath);
        if (csvRows.length > 0) {
            this.logger.infoVerbose(RESOURCES.readingValuesMappingFile, CONSTANTS.VALUE_MAPPING_CSV_FILENAME);
            csvRows.forEach(row => {
                if (row["ObjectName"] && row["FieldName"]) {
                    let key = String(row["ObjectName"]).trim() + String(row["FieldName"]).trim();
                    if (!this.csvValuesMapping.has(key)) {
                        this.csvValuesMapping.set(key, new Map<string, string>());
                    }
                    this.csvValuesMapping.get(key).set(String(row["RawValue"]).trim(), (String(row["Value"]) || "").trim());
                }
            });
        }
    }


    private async _mergeUserGroupCSVfiles(): Promise<void> {
        let filepath1 = path.join(this.script.basePath, "User.csv");
        let filepath2 = path.join(this.script.basePath, "Group.csv");
        let filepath3 = path.join(this.script.basePath, CONSTANTS.USER_AND_GROUP_FILENAME + ".csv");
        await Common.mergeCsvFilesAsync(filepath1, filepath2, filepath3, true, "Id", "Name");
    }

    private _copyCSVFilesToSourceSubDir() {
        this.tasks.forEach(task => {
            if (fs.existsSync(task.data.csvFilename)) {
                fs.copyFileSync(task.data.csvFilename, task.data.sourceCsvFilename);
            }
        });
    }

    private async _validateAndRepairSourceCSVFiles(): Promise<void> {

        let self = this;

        // Analyse csv structure
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            this.csvIssues = this.csvIssues.concat(await task.validateCSV());
        }

        // if csv structure issues were found - prompt to abort the job 
        let noAbortPrompt = false;
        if (this.csvIssues.length > 0) {
            await ___promptToAbort();
            noAbortPrompt = true;
        }

        // Check and repair the source csvs
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            this.csvIssues = this.csvIssues.concat(await task.repairCSV(this.cachedCSVContent));
        }

        // Save the changed source csvs
        await this.saveCachedCsvDataFiles();
        this.logger.infoVerbose(RESOURCES.csvFilesWereUpdated, String(this.cachedCSVContent.updatedFilenames.size));

        // if csv data issues were found - prompt to abort the job 
        //  and save the report
        if (this.csvIssues.length > 0) {
            if (!noAbortPrompt) {
                await ___promptToAbort();
            } else {
                await self.saveCSVFileAsync(CONSTANTS.CSV_ISSUES_ERRORS_FILENAME, self.csvIssues);
                this.logger.warn(RESOURCES.issuesFoundDuringCSVValidation, String(this.csvIssues.length), CONSTANTS.CSV_ISSUES_ERRORS_FILENAME);
            }
        } else {
            this.logger.infoVerbose(RESOURCES.noIssuesFoundDuringCSVValidation);
        }

        async function ___promptToAbort(): Promise<void> {
            await Common.abortWithPrompt(self.logger,
                RESOURCES.issuesFoundDuringCSVValidation,
                self.script.promptOnIssuesInCSVFiles,
                RESOURCES.continueTheJobPrompt,
                "",
                async () => {
                    // Report csv issues
                    await self.saveCSVFileAsync(CONSTANTS.CSV_ISSUES_ERRORS_FILENAME, self.csvIssues);
                },
                String(self.csvIssues.length), CONSTANTS.CSV_ISSUES_ERRORS_FILENAME);
        }

    }
}



// --------------------------- Helper classes -------------------------------------
/**
 * The format of columns for a CSV issues report file
 *
 * @export
 * @interface ICSVIssueCsvRow
 */
export interface ICSVIssueCsvRow {
    "Date update": string,
    "Child value": string,
    "Child sObject": string,
    "Child field": string,
    "Parent value": string,
    "Parent sObject": string,
    "Parent field": string,
    "Error": string
}

/**
 * The format of missing lookup records CSV file
 *
 * @export
 * @interface IMissingParentLookupRecordCsvRow
 */
export interface IMissingParentLookupRecordCsvRow {
    "Date update": string,
    "Child lookup object": string;
    "Child lookup field": string;
    "Child ExternalId field": string;
    "Parent lookup object": string;
    "Parent ExternalId field": string;
    "Missing parent ExternalId value": string;
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