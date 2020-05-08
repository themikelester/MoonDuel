export interface Component { }

export interface ComponentClass<T extends Component> {
    readonly name: string;
    new(): T;
}