/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */


// -------------------------------------------------------
// The shared SFDMU Addon package.
// 
// This package is intended to be shared with the end-user
// who is developing the custom SFDMU Addons.
// -------------------------------------------------------


/* ------------------ Common ------------------ */
export enum PLUGIN_TASK_DATA_MEDIA_TYPE {
    Org,
    File
}

/**
 * The information about the running sfdmu command.
 *
 * @export
 * @interface ICommandRunInfo
 */
export interface ICommandRunInfo {
    // --sourceusername command flag 
    sourceUsername: string,
    // --targetusername command flag
    targetUsername: string,
    // --apiversion command flag
    apiVersion: string,
    // the location of the export.json file
    readonly basePath: string,
    // the information about the Plugin and the framework
    readonly pinfo: IPluginInfo
}

/**
 * The information about the running Plugin
 */
export interface IPluginInfo {
    // The Plugin name (f.ex. sfdmu)
    pluginName: string,
    // The executed command (f.ex. run)
    commandName: string,
    // Version of the Plugin (f.ex. 5.0.0)
    version: string,
    // Path to the directory where the Sfdmu Plugin is installed
    path: string,
    // Full CLI string used to run the command (sfdx sfdmu:run --sourceusername a@mail.com --targetusername b@mail.com)
    commandString: string,
    // The array of CLI arguments ('--sourceusername', 'a@mail.com', '--targetusername', 'b@mail.com')
    argv: string[]
}

/**
 * Describes table to output it to the console.
 */
export interface ITableMessage {
    tableBody: Array<object>,
    tableColumns: Array<{
        key: string,
        label: string,
        width?: number
    }>
}

/**
 * Holds the data for the migration job
 */
export interface IPluginJob {
    tasks: IPluginTask[],
}

/**
 * Holds the data per migration task
 */
export interface IPluginTask {
    readonly sourceToTargetRecordMap: Map<any, any>,
    readonly sourceTaskData: IPluginTaskData,
    readonly targetTaskData: IPluginTaskData,
    readonly sObjectName: string
}

/**
 * Holds the data for each data layer (Source / Target) per migration task
 */
export interface IPluginTaskData {
    readonly records: Array<any>,
    readonly isSource: boolean,
    readonly extIdRecordsMap: Map<string, string>,
    readonly idRecordsMap: Map<string, any>,
    readonly sObjectName: string,
    readonly mediaType: PLUGIN_TASK_DATA_MEDIA_TYPE
}



/* ------------------ IPluginExecutionContext ------------------ */
/**
 * Provides the context that the Addon was currently colled in it.
 */
export interface IPluginExecutionContext {
    /**
     * The name of the event 
     * which the Addon module was executed int it context.
     */
    eventName: string;

    /**
     * The name of the object which was requested
     * to be processed (null for the global script events)
     * 
     */
    objectName: string;
}


/* ------------------ IAddonModule ------------------ */
/**
 * The interface to be implemented in each SFDMU Addon.
 */
export interface IAddonModule {

    /**
     * The Plugin will share with the Addon its public
     *   methods and runtime data using this property
     */
    runtime: IPluginRuntime;

    /**
     * The main method which is executed by the Plugin
     * when the Addon is running.
     *
     * @param {any} args The user's arguments passed from the 
     *                        manifest file.
     * @returns {any} Updated runTime data to be passed to the next
     *                Addon in the method chain.
     */
    onExecute(context: IPluginExecutionContext, args: any): void;

}




/* ------------------ IPluginRuntime ------------------ */
/**
* Provides access to the SFDMU runtime functionality.
*
* The SFDMU Addon can use its methods to perform
*  a variety of actions on the live data, connected orgs, etc.
*  when the Plugin command is running.
*/
export interface IPluginRuntime {

    // ---------- Props ------------ //
    /**
     * Returns the information about the running command.
     */
    runInfo: ICommandRunInfo,

    /**
    * All data related to the current migration job,
    * which has collected from all core processes.
    *
    * @type {IPluginJob}
    * @memberof IPluginRuntime
    */
    pluginJob: IPluginJob;




    // ---------- Methods ------------ //s
    /**
     *  Returns the jsforce.Connection object 
     *   that can be directly used by the Addon 
     *   to call the SF API
     * @return {jsforce.Connection}
     */
    getConnection(isSource: boolean): any,

    /**
     * Returns the information about the connected Orgs.
     */
    getOrgInfo(isSource: boolean): {
        instanceUrl: string,
        accessToken: string,
        apiVersion: string,
        isFile: boolean,
    };

    /**
     * Write a message to the console or/and log file.
     * All the messages are written with the VERBOSE verbosity level.
     */
    writeLogConsoleMessage(message: string | object | ITableMessage, messageType?: "INFO" | "WARNING" | "ERROR" | "OBJECT" | "TABLE"): void;

    /**
     * Retrieves the records from the connected salesforce environment
     * or from the CSV file (depend on the runtime)
     * 
     * @return {Array<any>} The array of the retrieved records     
     */
    queryAsync(isSource: boolean, soql: string, useBulkQueryApi: boolean): Promise<Array<any>>;

    /**
     * Retrieves the records from the connected salesforce environment
     * or from the CSV file (depend on the runtime)
     * 
     * (used to join retrieved records by the multple soql queries)
     * 
     * @return {Array<any>} The array of all retrieved records     
     */
    queryMultiAsync(isSource: boolean, soqls: string[], useBulkQueryApi: boolean): Promise<Array<any>>;

    /**
      
     */
    createFieldInQueries(selectFields: Array<string>, fieldName: string, sObjectName: string, valuesIN: Array<string>): Array<string>;


}











