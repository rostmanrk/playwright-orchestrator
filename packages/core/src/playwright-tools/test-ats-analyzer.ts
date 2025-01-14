import * as ts from 'typescript';
import { Location, Suite, TestCase } from '@playwright/test/reporter';

const FILTER_PROPERTIES = ['setTimeout', 'slow', 'configure'];

export class TestASTAnalyzer {
    private readonly program: ts.Program;
    private readonly typeChecker: ts.TypeChecker;
    private readonly sourceFile: ts.SourceFile;

    private constructor(file: string) {
        this.program = ts.createProgram([file], {
            allowJs: true,
            checkJs: true,
        });
        this.typeChecker = this.program.getTypeChecker();
        this.sourceFile = this.program.getSourceFile(file)!;
    }

    static create(file?: string): TestASTAnalyzer | undefined {
        if (!file) return;
        return new TestASTAnalyzer(file);
    }

    suiteIsSerial(suite: Suite) {
        if (!suite.location || (suite.location.line === 0 && suite.location.column == 0)) {
            return this.checkFileSerialStatement();
        }
        const suiteNode = this.findNodeAtLocation(suite.location);
        if (
            !suiteNode ||
            !ts.isPropertyAccessExpression(suiteNode) ||
            !ts.isIdentifier(suiteNode.expression) ||
            !ts.isCallExpression(suiteNode.parent)
        )
            return false;
        const testNodeText = suiteNode.expression.text;

        var testStatements = this.extractTestCallStatements(
            this.extractCallStatementsTestFunc(suiteNode.parent),
            testNodeText,
        );

        // last statement wins
        for (let i = testStatements.length - 1; i >= 0; i--) {
            if (this.isSerialStatement(testStatements[i])) return true;
        }

        return false;
    }

    getTimeout(entry: TestCase | Suite): number {
        if (entry.type === 'test') return this.findTestTimeout(entry);

        return entry.entries().reduce((timeout, entry) => this.getTimeout(entry) + timeout, 0);
    }

    private checkFileSerialStatement() {
        return this.sourceFile.statements
            .filter((statement) => ts.isExpressionStatement(statement))
            .map((statement) => (statement as ts.ExpressionStatement).expression as ts.CallExpression)
            .some((statement) => this.isSerialStatement(statement));
    }

    private isSerialStatement(statement: ts.CallExpression) {
        const expression = statement.expression;
        if (
            !ts.isPropertyAccessExpression(expression) ||
            expression.name.text !== 'configure' ||
            !ts.isPropertyAccessExpression(expression.expression) ||
            expression.expression.name.text !== 'describe' ||
            statement.arguments.length === 0
        )
            return false;
        const arg = statement.arguments[0];
        return (
            ts.isObjectLiteralExpression(arg) &&
            arg.properties.some((prop) => {
                return (
                    prop.name?.getText() === 'mode' &&
                    ts.isPropertyAssignment(prop) &&
                    ts.isStringLiteral(prop.initializer) &&
                    prop.initializer.text === 'serial'
                );
            })
        );
    }

    private getFunctionBodyStatements(node: ts.Node): ts.Statement[] {
        if (ts.isFunctionLike(node)) {
            const body = (node as ts.FunctionLikeDeclaration).body!;

            // Handle block body (FunctionDeclaration, FunctionExpression, MethodDeclaration)
            if (ts.isBlock(body)) {
                return [...body.statements];
            }

            // Handle expression body (ArrowFunction)
            if (ts.isExpression(body)) {
                return [ts.factory.createExpressionStatement(body)];
            }
        }

        // Handle function expressions in variable declarations
        if (ts.isVariableDeclaration(node) && node.initializer) {
            if (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)) {
                return this.getFunctionBodyStatements(node.initializer);
            }
        }

        return [];
    }

    private extractCallStatementsTestFunc(node: ts.CallExpression) {
        return this.getFunctionBodyStatements(node.arguments.find((arg) => ts.isFunctionLike(arg))!);
    }

    private extractTestCallStatements(nodes: ts.Node[], testNodeText: string) {
        return nodes
            .filter((statement) => ts.isExpressionStatement(statement) && this.isTestStatement(statement, testNodeText))
            .map((statement) => (statement as ts.ExpressionStatement).expression as ts.CallExpression);
    }

    private isTestStatement(statement: ts.ExpressionStatement, testNodeText: string) {
        if (!ts.isCallExpression(statement.expression)) return false;
        let node = statement.expression.getChildAt(0) as ts.Node;
        if (!ts.isPropertyAccessExpression(node) || !FILTER_PROPERTIES.includes(node.name.text)) return false;
        while (!ts.isIdentifier(node) && node.getChildCount() > 0) node = node.getChildAt(0);
        return node.getText() === testNodeText;
    }

    private isSlowStatement(statement: ts.CallExpression) {
        const expression = statement.expression;
        const functionName = expression.getChildAt(expression.getChildCount() - 1);
        return functionName.getText() === 'slow';
    }

    private getTimeoutFromStatement(statement: ts.CallExpression) {
        const expression = statement.expression;
        if (
            !ts.isCallExpression(statement) ||
            statement.arguments.length === 0 ||
            !ts.isPropertyAccessExpression(expression) ||
            expression.name.text !== 'setTimeout'
        )
            return 0;
        return this.getNumberIdentifierValue(statement.arguments[0]);
    }

    private getNumberIdentifierValue(node: ts.Node) {
        if (ts.isNumericLiteral(node)) return parseInt(node.text, 10);
        if (ts.isIdentifier(node)) {
            const symbol = this.typeChecker.getSymbolAtLocation(node);
            if (!symbol) return 0;
            const declarations = symbol.declarations;
            if (!declarations || declarations.length === 0) return 0;
            const declaration = declarations[0];
            if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
                if (ts.isNumericLiteral(declaration.initializer)) {
                    return parseInt(declaration.initializer.text, 10);
                }
            }
        }
        return 0;
    }

    private findTestTimeout(test: TestCase): number {
        const { location, timeout } = test;

        const testNode = this.findNodeAtLocation(location);
        if (!testNode || !ts.isIdentifier(testNode)) return timeout;
        const testNodeText = testNode.text;

        if (!ts.isCallExpression(testNode.parent)) return timeout;
        var testStatements = this.extractTestCallStatements(
            this.extractCallStatementsTestFunc(testNode.parent),
            testNodeText,
        );

        // last statement wins
        for (let i = testStatements.length - 1; i >= 0; i--) {
            const statement = testStatements[i];
            if (this.isSlowStatement(statement)) return timeout * 3;
            const localTimeout = this.getTimeoutFromStatement(statement);
            if (localTimeout) return localTimeout;
        }

        return timeout;
    }

    private findNodeAtLocation(location: Location): ts.Node | undefined {
        let position = ts.getPositionOfLineAndCharacter(
            this.sourceFile,
            Math.max(0, location.line - 1), // ts using 0-based index location
            Math.max(0, location.column - 1),
        );
        if (position > 0) position -= 1;

        const findSmallestContainingNode = (node: ts.Node): ts.Node | undefined => {
            for (const child of node.getChildren()) {
                if (child.getStart() < position && position < child.getEnd()) {
                    return findSmallestContainingNode(child);
                }
            }
            return node;
        };

        return findSmallestContainingNode(this.sourceFile);
    }
}
