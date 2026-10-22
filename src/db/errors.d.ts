/**
* Custom HTTP error class to handle API error responses uniformly.
*/
export declare class HttpError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string);
}
//# sourceMappingURL=errors.d.ts.map