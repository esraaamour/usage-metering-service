/**
* Custom HTTP error class to handle API error responses uniformly.
*/

export class HttpError extends Error{
  constructor(
     public statusCode: number,
     public code: string,
     message: string
){
     super(message);
     this.name = 'HttpError';
   }
}
