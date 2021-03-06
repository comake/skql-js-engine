import * as mime from 'mime-types';
import { v4 as uuid } from 'uuid';
import { GREL, IDLAB } from './util/Vocabularies';

export const functions = {
  [GREL.arrayJoin]([ separator, ...parts ]: string[]): string {
    return parts.join(separator);
  },
  [GREL.controlsIf](data: Record<string | number, any>): boolean {
    if (
      (typeof data[GREL.boolB] === 'string' && data[GREL.boolB] === 'true') ||
      (typeof data[GREL.boolB] === 'boolean' && data[GREL.boolB])
    ) {
      return data[GREL.anyTrue];
    }
    return data[GREL.anyFalse] || null;
  },
  [GREL.stringEndsWith](data: any): boolean {
    const string = data[GREL.valueParameter];
    const suffix = data[GREL.stringSub];
    return typeof string === 'string' && string.endsWith(suffix);
  },
  [GREL.stringReplace](data: any): boolean {
    const string = data[GREL.valueParameter];
    const replace = data[GREL.pStringFind];
    const value = data[GREL.pStringReplace];
    return string.replace(replace, value);
  },
  [IDLAB.equal]([ argA, argB ]: string[]): boolean {
    return argA === argB;
  },
  [IDLAB.notEqual]([ argA, argB ]: string[]): boolean {
    return argA !== argB;
  },
  [IDLAB.getMimeType](data: any): any {
    return mime.lookup(data[IDLAB.str]);
  },
  [IDLAB.isNull](data: any): boolean {
    const value = data[IDLAB.str];
    return Array.isArray(value) ? value.length === 0 : !value;
  },
  [IDLAB.random](): string {
    return uuid();
  },
};
