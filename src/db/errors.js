/**
* Custom HTTP error class to handle API error responses uniformly.
*/
export class HttpError extends Error {
    statusCode;
    code;
    constructor(statusCode, code, message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'HttpError';
    }
}
//# sourceMappingURL=errors.js.map