import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { portForSecure } from './ServerFormFields';
import { Button, Card, Field, Segmented, Setting, Switch, Tabs } from './ui';

describe('Button', () => {
  it('is a plain button that does not submit a form unless asked', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit" variant="primary">
          Go
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('can be small, and passes clicks through', () => {
    const onClick = vi.fn();
    render(
      <Button small variant="danger" onClick={onClick}>
        Remove
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('names its control by the label, so the control is found by it', () => {
    render(
      <Field label="Nickname">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText('Nickname')).toBeTruthy();
  });
});

describe('Setting', () => {
  it('names a switch, select or input by the title alone, not by the description', () => {
    render(
      <Card>
        <Setting title="Use TLS" description="Encrypt the connection.">
          <Switch defaultChecked />
        </Setting>
        <Setting title="Font size">
          <select>
            <option>Small</option>
          </select>
        </Setting>
        <Setting title="Highlight words">
          <input />
        </Setting>
      </Card>,
    );
    expect((screen.getByRole('checkbox', { name: 'Use TLS' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Font size' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Highlight words' })).toBeTruthy();
    expect(screen.getByText('Encrypt the connection.')).toBeTruthy();
  });

  it('leaves other children alone and renders a row with no control', () => {
    render(
      <Card>
        <Setting title="With button">
          <Button>Act</Button>
        </Setting>
        <Setting title="Just a title" />
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy();
    expect(screen.getByText('Just a title')).toBeTruthy();
  });
});

describe('Switch', () => {
  it('toggles like a checkbox', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Mute" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mute' }));
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Tabs and Segmented', () => {
  it('marks the selected tab and reports a new choice', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('marks the chosen option of a radio group and reports another', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Theme"
        value="dark"
        onChange={onChange}
        options={[
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledWith('light');
  });
});

describe('portForSecure', () => {
  it('moves the default port with TLS, but leaves a port that was typed by hand', () => {
    expect(portForSecure('6667', true)).toBe('6697');
    expect(portForSecure('6697', false)).toBe('6667');
    expect(portForSecure('7000', true)).toBe('7000');
  });
});
