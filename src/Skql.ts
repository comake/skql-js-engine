/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fsPromises } from 'fs';
import SHACLValidator from 'rdf-validate-shacl';
import { Mapper } from './Mapper';
import type { OpenApi } from './util/openapi/OpenapiSchemaConfiguration';
import { executeOpenApiOperation } from './util/openapi/OpenapiUtil';
import { constructUri, convertJsonLdToQuads, toJSON } from './util/Util';
import { SKL } from './util/Vocabularies';

export type VerbHandler = (args: any) => any;

export interface SetSchemaArgs {
  schema?: Record<string, any>[];
  file?: string;
}

export class SKQLBase {
  private readonly mapper: Mapper;
  private schema: any;

  public constructor() {
    this.mapper = new Mapper();
  }

  public async setSchema(args: SetSchemaArgs): Promise<void> {
    if (args.schema) {
      this.schema = args.schema;
    } else if (args.file) {
      const schema = await fsPromises.readFile(args.file, 'utf8');
      this.schema = JSON.parse(schema);
    } else {
      throw new Error('No schema source found in setSchema args.');
    }
  }

  public getSchemaById(id: string): any {
    const schema = this.schema.find((schemaInstance: any): boolean => schemaInstance['@id'] === id);
    if (schema) {
      return schema;
    }

    throw new Error(`No schema found with id ${id}`);
  }

  public getSchemaByFields(fields: any): any {
    const schema = this.schema.find((schemaInstance: any): boolean => {
      const schemaFields = Object.entries(fields);
      return schemaFields.every(([ fieldName, fieldValue ]): boolean => fieldName in schemaInstance &&
        (typeof schemaInstance[fieldName] === 'object'
          ? schemaInstance[fieldName]['@id'] === fieldValue
          : schemaInstance[fieldName] === fieldValue
        ));
    });

    if (schema) {
      return schema;
    }

    throw new Error(`No schema found with fields matching ${JSON.stringify(fields)}`);
  }

  public constructVerbHandlerFromSchema(verbName: string): VerbHandler {
    const verbSchemaId = constructUri(SKL.verbs, verbName);
    try {
      const verb = this.getSchemaById(verbSchemaId);
      return this.constructVerbHandler(verb);
    } catch {
      throw new Error(`User does not have the verb ${verbName} installed.`);
    }
  }

  private constructVerbHandler(verb: any): VerbHandler {
    return async(args: any): Promise<any> => {
      // Assert params match
      await this.assertVerbArgsMatchParameterSchemas(args, verb[SKL.parametersProperty], verb[SKL.nameProperty]);
      const account = this.getSchemaById(args.account);
      // Find mapping for verb and integration
      const mapping = this.getSchemaByFields({
        '@type': SKL.verbToIntegrationMappingNoun,
        [SKL.verbsProperty]: verb['@id'],
        [SKL.integrationProperty]: account[SKL.integrationProperty]['@id'],
      });
      // Perform mapping of args
      const operationArgsJsonLd = await this.mapper.apply(args, mapping[SKL.parameterMappingsProperty]);
      const operationArgs = toJSON(operationArgsJsonLd);

      const operationInfoJsonLd = await this.mapper.apply(args, mapping[SKL.operationMappingsProperty]);
      const { operationId } = toJSON(operationInfoJsonLd);

      const openApiDescriptionSchema = this.getSchemaByFields({
        '@type': SKL.openApiDescriptionNoun,
        [SKL.integrationProperty]: account[SKL.integrationProperty]['@id'],
      });

      const oauthTokenSchema = this.getSchemaByFields({
        '@type': SKL.oauthTokenNoun,
        [SKL.accountProperty]: args.account,
      });

      const rawReturnValue = await executeOpenApiOperation(
        operationId as string,
        openApiDescriptionSchema[SKL.openApiDescriptionProperty]['@value'] as OpenApi,
        { accessToken: oauthTokenSchema[SKL.accessTokenProperty] },
        operationArgs,
      );

      // Perform mapping of return value
      const mappedReturnValue = await this.mapper.apply(rawReturnValue.data, mapping[SKL.returnValueMappingsProperty]);
      await this.assertVerbReturnValueMatchesReturnTypeSchema(mappedReturnValue, verb[SKL.returnValueProperty]);
      return mappedReturnValue;
    };
  }

  private async assertVerbArgsMatchParameterSchemas(verbParams: any,
    parameterSchemas: any, verbName: string): Promise<void> {
    const returnValueAsQuads = await convertJsonLdToQuads([ verbParams ]);
    const shape = await convertJsonLdToQuads(parameterSchemas);
    const validator = new SHACLValidator(shape);
    const report = validator.validate(returnValueAsQuads);
    if (!report.conforms) {
      throw new Error(`${verbName} parameters do not conform to schema`);
    }
  }

  private async assertVerbReturnValueMatchesReturnTypeSchema(returnValue: any, returnTypeSchema: any): Promise<void> {
    const returnValueAsQuads = await convertJsonLdToQuads([ returnValue ]);

    let returnTypeSchemaObject;
    if (typeof returnTypeSchema === 'object' && returnTypeSchema['@type']) {
      returnTypeSchemaObject = returnTypeSchema;
    } else if (typeof returnTypeSchema === 'object' && returnTypeSchema['@id']) {
      returnTypeSchemaObject = this.getSchemaById(returnTypeSchema['@id']);
    }

    const shape = await convertJsonLdToQuads(returnTypeSchemaObject);
    const validator = new SHACLValidator(shape);
    const report = validator.validate(returnValueAsQuads);
    if (!report.conforms) {
      throw new Error(`Return value ${returnValue['@id']} does not conform to schema`);
    }
  }
}

export type VerbInterface = Record<string, VerbHandler>;

export type SKQLProxy = VerbInterface & SKQLBase;

function SKQLProxyBuilder(target: SKQLBase): SKQLProxy {
  const skqlProxyHandler = {
    get(getTarget: SKQLBase, property: string): any {
      if (property in getTarget) {
        return (getTarget as any)[property];
      }
      return getTarget.constructVerbHandlerFromSchema(property);
    },
  };
  return new Proxy(target, skqlProxyHandler) as SKQLProxy;
}

export const SKQL = SKQLProxyBuilder(new SKQLBase());
